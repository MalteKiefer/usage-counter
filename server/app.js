import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from './db.js';
import { isId } from './validation.js';
import {
  neighbourError,
  nameError,
  tankSizeError,
  validateReading,
  validateRefill,
  validateTankLevel,
} from './rules.js';
import { BackupError, exportBackup, restoreBackup } from './backup.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const app = express();

const METER_KINDS = ['oil', 'water', 'power'];
const ALLOWED_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '::1',
  '[::1]',
  ...(process.env.ALLOWED_HOSTS ?? '').split(',').map((h) => h.trim()).filter(Boolean),
]);

const stmt = {
  objects: db.prepare('SELECT id, name, tank_size FROM objects ORDER BY id'),
  objectById: db.prepare('SELECT id, name, tank_size FROM objects WHERE id = ?'),
  insertObject: db.prepare('INSERT INTO objects (name, tank_size) VALUES (?, ?)'),
  updateObject: db.prepare('UPDATE objects SET name = ?, tank_size = ? WHERE id = ?'),
  removeObject: db.prepare('DELETE FROM objects WHERE id = ?'),
  highestLevel: db.prepare(`
    SELECT MAX(v) AS max FROM (
      SELECT level_after AS v FROM refills WHERE object_id = ?
      UNION ALL SELECT r.tank_level FROM readings r JOIN meters m ON m.id = r.meter_id WHERE m.object_id = ?
      UNION ALL SELECT level FROM tank_levels WHERE object_id = ?)`),
  metersOf: db.prepare('SELECT id, object_id, kind, name, sub_of FROM meters WHERE object_id = ? ORDER BY id'),
  meterById: db.prepare('SELECT id, object_id, kind, name, sub_of FROM meters WHERE id = ?'),
  insertMeter: db.prepare('INSERT INTO meters (object_id, kind, name, sub_of) VALUES (?, ?, ?, ?)'),
  removeMeter: db.prepare('DELETE FROM meters WHERE id = ?'),
  oilMeterOf: db.prepare("SELECT id FROM meters WHERE object_id = ? AND kind = 'oil' ORDER BY id LIMIT 1"),
  readingsOf: db.prepare(`
    SELECT r.id, r.meter_id, m.kind, r.read_at, r.meter, r.tank_level, r.note
    FROM readings r JOIN meters m ON m.id = r.meter_id
    WHERE m.object_id = ? ORDER BY r.read_at ASC`),
  readingById: db.prepare(`
    SELECT r.id, r.meter_id, m.kind, r.read_at, r.meter, r.tank_level, r.note
    FROM readings r JOIN meters m ON m.id = r.meter_id WHERE r.id = ?`),
  insertReading: db.prepare('INSERT INTO readings (meter_id, read_at, meter, tank_level, note) VALUES (?, ?, ?, ?, ?)'),
  prevReading: db.prepare('SELECT meter FROM readings WHERE meter_id = ? AND read_at < ? ORDER BY read_at DESC LIMIT 1'),
  nextReading: db.prepare('SELECT meter FROM readings WHERE meter_id = ? AND read_at > ? ORDER BY read_at ASC LIMIT 1'),
  removeReading: db.prepare('DELETE FROM readings WHERE id = ?'),
  refillsOf: db.prepare(
    'SELECT id, filled_at, meter, liters, total_eur, level_after, note FROM refills WHERE object_id = ? ORDER BY filled_at ASC',
  ),
  insertRefill: db.prepare(
    'INSERT INTO refills (object_id, filled_at, meter, liters, total_eur, level_after, note) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ),
  refillById: db.prepare(
    'SELECT id, filled_at, meter, liters, total_eur, level_after, note FROM refills WHERE id = ?',
  ),
  removeRefill: db.prepare('DELETE FROM refills WHERE id = ?'),
  tankLevelsOf: db.prepare('SELECT id, read_at, level, note FROM tank_levels WHERE object_id = ? ORDER BY read_at ASC'),
  insertTankLevel: db.prepare('INSERT INTO tank_levels (object_id, read_at, level, note) VALUES (?, ?, ?, ?)'),
  tankLevelById: db.prepare('SELECT id, read_at, level, note FROM tank_levels WHERE id = ?'),
  removeTankLevel: db.prepare('DELETE FROM tank_levels WHERE id = ?'),
};


function checkMonotonic(meterId, readAt, meter) {
  return neighbourError(stmt.prevReading.get(meterId, readAt), stmt.nextReading.get(meterId, readAt), meter);
}

function highestLevel(objectId) {
  return stmt.highestLevel.get(objectId, objectId, objectId).max;
}

function objectOr404(id, res) {
  const object = isId(id) ? stmt.objectById.get(id) : null;
  if (!object) res.status(404).json({ error: 'Objekt nicht gefunden' });
  return object;
}

function removeById(statement) {
  return (req, res) => {
    const id = Number(req.params.id);
    if (!isId(id)) {
      return res.status(400).json({ error: 'Ungültige ID' });
    }
    if (statement.run(id).changes === 0) {
      return res.status(404).json({ error: 'Nicht gefunden' });
    }
    res.status(204).end();
  };
}

// DNS rebinding: a foreign page can point its own name at 127.0.0.1, so the Host header decides.
app.use((req, res, next) => {
  if (!ALLOWED_HOSTS.has(req.hostname)) {
    return res.status(403).json({ error: 'Host nicht erlaubt' });
  }
  next();
});

app.use((_req, res, next) => {
  res.set({
    'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'",
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
  });
  next();
});

// Restore is the only route that takes a large body. The default parser skips it.
const jsonDefault = express.json();
app.use('/api/restore', express.json({ limit: '10mb' }));
app.use((req, res, next) => (req.path.startsWith('/api/restore') ? next() : jsonDefault(req, res, next)));

app.get('/api/backup', (_req, res) => {
  const date = new Date().toISOString().slice(0, 10);
  res.set({
    'Content-Disposition': `attachment; filename="usage-counter-backup-${date}.json"`,
    'Cache-Control': 'no-store',
  });
  res.json(exportBackup());
});

app.post('/api/restore', (req, res) => {
  if (req.query.confirm !== 'replace') {
    return res.status(422).json({ error: 'Wiederherstellung nicht bestätigt' });
  }
  try {
    res.json(restoreBackup(req.body));
  } catch (err) {
    if (err instanceof BackupError) return res.status(422).json({ error: err.message });
    throw err;
  }
});

// Objects (Häuser, Wohnungen, ...) and their meters.

app.get('/api/objects', (_req, res) => {
  res.json(stmt.objects.all());
});

app.post('/api/objects', (req, res) => {
  const body = req.body ?? {};
  const error = nameError(body.name) ?? tankSizeError(body.tank_size ?? null);
  if (error) return res.status(422).json({ error });
  const info = stmt.insertObject.run(body.name.trim(), body.tank_size ?? null);
  res.status(201).json(stmt.objectById.get(Number(info.lastInsertRowid)));
});

app.put('/api/objects/:id', (req, res) => {
  const object = objectOr404(Number(req.params.id), res);
  if (!object) return;
  const body = req.body ?? {};
  const name = body.name ?? object.name;
  const tankSize = body.tank_size !== undefined ? body.tank_size : object.tank_size;
  const error = nameError(name) ?? tankSizeError(tankSize);
  if (error) return res.status(422).json({ error });
  const highest = highestLevel(object.id);
  if (tankSize != null && highest != null && tankSize < highest) {
    return res.status(422).json({ error: `Tankgröße liegt unter vorhandenem Füllstand (${highest} L)` });
  }
  stmt.updateObject.run(name.trim(), tankSize, object.id);
  res.json(stmt.objectById.get(object.id));
});

app.delete('/api/objects/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!objectOr404(id, res)) return;
  stmt.removeObject.run(id);
  res.status(204).end();
});

app.get('/api/objects/:id/meters', (req, res) => {
  if (!objectOr404(Number(req.params.id), res)) return;
  res.json(stmt.metersOf.all(Number(req.params.id)));
});

app.post('/api/objects/:id/meters', (req, res) => {
  const object = objectOr404(Number(req.params.id), res);
  if (!object) return;
  const body = req.body ?? {};
  let error = nameError(body.name) ?? (METER_KINDS.includes(body.kind) ? null : 'Unbekannte Zählerart');
  let subOf = null;
  if (!error && body.sub_of != null) {
    const parent = isId(body.sub_of) ? stmt.meterById.get(body.sub_of) : null;
    if (!parent || parent.object_id !== object.id || parent.kind !== 'water' || parent.sub_of != null) {
      error = 'Untermesser braucht einen Wasserzähler desselben Objekts';
    } else if (body.kind !== 'water') {
      error = 'Untermesser ist nur für Wasser möglich';
    }
    subOf = parent?.id ?? null;
  }
  if (error) return res.status(422).json({ error });
  const info = stmt.insertMeter.run(object.id, body.kind, body.name.trim(), subOf);
  res.status(201).json(stmt.meterById.get(Number(info.lastInsertRowid)));
});

app.delete('/api/meters/:id', removeById(stmt.removeMeter));

// Readings: one object or an array. An array is saved in one transaction: either all entries or none.

app.get('/api/objects/:id/readings', (req, res) => {
  if (!objectOr404(Number(req.params.id), res)) return;
  res.json(stmt.readingsOf.all(Number(req.params.id)));
});

app.post('/api/readings', (req, res) => {
  const isBatch = Array.isArray(req.body);
  const items = isBatch ? req.body : [req.body ?? {}];
  const meterIds = items.map((item) => item?.meter_id);
  if (new Set(meterIds).size !== meterIds.length) {
    return res.status(422).json({ error: 'Je Zähler nur eine Ablesung pro Vorgang' });
  }
  for (const [index, item] of items.entries()) {
    const meter = isId(item?.meter_id) ? stmt.meterById.get(item.meter_id) : null;
    const object = meter ? stmt.objectById.get(meter.object_id) : null;
    const error = !meter
      ? 'Unbekannter Zähler'
      : validateReading(item, meter, object.tank_size) ?? checkMonotonic(meter.id, item.read_at, item.meter);
    if (error) {
      return res.status(422).json({ error: isBatch ? `Eintrag ${index + 1}: ${error}` : error });
    }
  }
  try {
    db.exec('BEGIN');
    const rows = items.map((item) => {
      const info = stmt.insertReading.run(
        item.meter_id,
        item.read_at,
        item.meter,
        item.tank_level ?? null,
        (item.note ?? '').trim(),
      );
      return stmt.readingById.get(Number(info.lastInsertRowid));
    });
    db.exec('COMMIT');
    res.status(201).json(isBatch ? rows : rows[0]);
  } catch (err) {
    if (db.isTransaction) db.exec('ROLLBACK');
    if (err.message.includes('UNIQUE')) {
      return res.status(409).json({ error: 'Für diesen Zeitpunkt gibt es bereits eine Ablesung' });
    }
    throw err;
  }
});

app.delete('/api/readings/:id', removeById(stmt.removeReading));

// Tank: refills and gauge values belong to an object.

app.get('/api/objects/:id/tank-levels', (req, res) => {
  if (!objectOr404(Number(req.params.id), res)) return;
  res.json(stmt.tankLevelsOf.all(Number(req.params.id)));
});

app.post('/api/objects/:id/tank-levels', (req, res) => {
  const object = objectOr404(Number(req.params.id), res);
  if (!object) return;
  const body = req.body ?? {};
  const error = validateTankLevel(body, object.tank_size);
  if (error) return res.status(422).json({ error });
  try {
    const info = stmt.insertTankLevel.run(object.id, body.read_at, body.level, (body.note ?? '').trim());
    res.status(201).json(stmt.tankLevelById.get(Number(info.lastInsertRowid)));
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      return res.status(409).json({ error: 'Für diesen Zeitpunkt gibt es bereits einen Anzeiger-Wert' });
    }
    throw err;
  }
});

app.delete('/api/tank-levels/:id', removeById(stmt.removeTankLevel));

app.get('/api/objects/:id/refills', (req, res) => {
  if (!objectOr404(Number(req.params.id), res)) return;
  res.json(stmt.refillsOf.all(Number(req.params.id)));
});

app.post('/api/objects/:id/refills', (req, res) => {
  const object = objectOr404(Number(req.params.id), res);
  if (!object) return;
  const body = req.body ?? {};
  const oil = stmt.oilMeterOf.get(object.id);
  const error =
    validateRefill(body, object.tank_size) ??
    (body.meter == null || !oil ? null : checkMonotonic(oil.id, body.filled_at, body.meter));
  if (error) return res.status(422).json({ error });
  const info = stmt.insertRefill.run(
    object.id,
    body.filled_at,
    body.meter ?? null,
    body.liters,
    body.total_eur ?? null,
    body.level_after ?? null,
    (body.note ?? '').trim(),
  );
  res.status(201).json(stmt.refillById.get(Number(info.lastInsertRowid)));
});

app.delete('/api/refills/:id', removeById(stmt.removeRefill));

app.use('/api', (_req, res) => res.status(404).json({ error: 'Nicht gefunden' }));

if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(root, 'dist')));
  app.get('/{*splat}', (_req, res) => res.sendFile(path.join(root, 'dist', 'index.html')));
}

app.use((err, _req, res, _next) => {
  if (err.status >= 400 && err.status < 500) {
    return res.status(err.status).json({ error: 'Ungültige Anfrage' });
  }
  console.error(err);
  res.status(500).json({ error: 'Serverfehler' });
});
