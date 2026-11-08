import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from './db.js';
import { config } from './config.js';
import { isId } from './validation.js';
import { isTankMeter } from '../src/lib/meters.js';
import {
  neighbourError,
  problem,
  nameError,
  serialError,
  tankError,
  tankUnitError,
  densityError,
  validateReading,
  validateRefill,
  validateTankLevel,
} from './rules.js';
import { BackupError, exportBackup, restoreBackup } from './backup.js';
import { authRouter, checkOrigin, loadUser, requireLogin, sessionView } from './auth.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const app = express();

const METER_KINDS = ['oil', 'water', 'power', 'gas'];

// Errors are codes that the client translates; params carry the values for the message.
const sendError = (res, status, code, params) => res.status(status).json({ error: code, params });
const sendProblem = (res, status, found) => sendError(res, status, found.code, found.params);
// Backup export and restore share one size limit, so every exported file can be restored.
const BACKUP_LIMIT_BYTES = config.backupLimitMb * 1024 * 1024;
const ALLOWED_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '::1',
  '[::1]',
  ...config.allowedHosts,
]);

const stmt = {
  objects: db.prepare('SELECT id, name FROM objects ORDER BY id'),
  objectById: db.prepare('SELECT id, name FROM objects WHERE id = ?'),
  insertObject: db.prepare('INSERT INTO objects (name) VALUES (?)'),
  updateObject: db.prepare('UPDATE objects SET name = ? WHERE id = ?'),
  removeObject: db.prepare('DELETE FROM objects WHERE id = ?'),
  metersOf: db.prepare(
    'SELECT id, object_id, kind, name, sub_of, serial, tank_size, tank_unit, tank_density FROM meters WHERE object_id = ? ORDER BY id',
  ),
  meterById: db.prepare(
    'SELECT id, object_id, kind, name, sub_of, serial, tank_size, tank_unit, tank_density FROM meters WHERE id = ?',
  ),
  insertMeter: db.prepare(
    'INSERT INTO meters (object_id, kind, name, sub_of, serial, tank_size, tank_unit, tank_density) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ),
  updateMeter: db.prepare('UPDATE meters SET name = ?, serial = ?, tank_size = ?, tank_unit = ?, tank_density = ? WHERE id = ?'),
  removeMeter: db.prepare('DELETE FROM meters WHERE id = ?'),
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
  // Highest fill level ever recorded for a tank, to keep a smaller tank size from cutting it off.
  highestLevel: db.prepare(`
    SELECT MAX(v) AS max FROM (
      SELECT level_after AS v FROM refills WHERE meter_id = ?
      UNION ALL SELECT tank_level FROM readings WHERE meter_id = ?
      UNION ALL SELECT level FROM tank_levels WHERE meter_id = ?)`),
  tankEntries: db.prepare(`
    SELECT (SELECT COUNT(*) FROM refills WHERE meter_id = ?)
      + (SELECT COUNT(*) FROM tank_levels WHERE meter_id = ?)
      + (SELECT COUNT(*) FROM readings WHERE meter_id = ? AND tank_level IS NOT NULL) AS n`),
  refillsOf: db.prepare(`
    SELECT f.id, f.meter_id, f.filled_at, f.meter, f.liters, f.total_eur, f.level_after, f.note
    FROM refills f JOIN meters m ON m.id = f.meter_id
    WHERE m.object_id = ? ORDER BY f.filled_at ASC`),
  insertRefill: db.prepare(
    'INSERT INTO refills (meter_id, filled_at, meter, liters, total_eur, level_after, note) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ),
  refillById: db.prepare(
    'SELECT id, meter_id, filled_at, meter, liters, total_eur, level_after, note FROM refills WHERE id = ?',
  ),
  removeRefill: db.prepare('DELETE FROM refills WHERE id = ?'),
  tankLevelsOf: db.prepare(`
    SELECT t.id, t.meter_id, t.read_at, t.level, t.note
    FROM tank_levels t JOIN meters m ON m.id = t.meter_id
    WHERE m.object_id = ? ORDER BY t.read_at ASC`),
  insertTankLevel: db.prepare('INSERT INTO tank_levels (meter_id, read_at, level, note) VALUES (?, ?, ?, ?)'),
  tankLevelById: db.prepare('SELECT id, meter_id, read_at, level, note FROM tank_levels WHERE id = ?'),
  removeTankLevel: db.prepare('DELETE FROM tank_levels WHERE id = ?'),
};


function checkMonotonic(meterId, readAt, meter) {
  return neighbourError(stmt.prevReading.get(meterId, readAt), stmt.nextReading.get(meterId, readAt), meter);
}

function highestLevel(meterId) {
  return stmt.highestLevel.get(meterId, meterId, meterId).max;
}

function objectOr404(id, res) {
  const object = isId(id) ? stmt.objectById.get(id) : null;
  if (!object) sendError(res, 404, 'object.notFound');
  return object;
}

function removeById(statement) {
  return (req, res) => {
    const id = Number(req.params.id);
    if (!isId(id)) {
      return sendError(res, 400, 'id.invalid');
    }
    if (statement.run(id).changes === 0) {
      return sendError(res, 404, 'not_found');
    }
    res.status(204).end();
  };
}

// DNS rebinding: a foreign page can point its own name at 127.0.0.1, so the Host header decides.
app.use((req, res, next) => {
  if (!ALLOWED_HOSTS.has(req.hostname)) {
    return sendError(res, 403, 'host.forbidden');
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
app.use('/api/restore', express.json({ limit: BACKUP_LIMIT_BYTES }));
app.use((req, res, next) => (req.path.startsWith('/api/restore') ? next() : jsonDefault(req, res, next)));

app.use(checkOrigin);
app.use(['/api', '/auth'], loadUser);
// Personal data: never cached by browsers or proxies.
app.get('/api/session', (req, res) => res.set('Cache-Control', 'no-store').json(sessionView(req.user)));
if (config.oidc.enabled) app.use(authRouter);
app.use('/api', requireLogin);

app.get('/api/backup', (_req, res) => {
  const body = JSON.stringify(exportBackup());
  if (Buffer.byteLength(body) > BACKUP_LIMIT_BYTES) {
    return sendError(res, 413, 'backup.tooLarge', { limitMb: config.backupLimitMb });
  }
  const date = new Date().toISOString().slice(0, 10);
  res.set({
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Disposition': `attachment; filename="usage-counter-backup-${date}.json"`,
    'Cache-Control': 'no-store',
  });
  res.send(body);
});

app.post('/api/restore', (req, res) => {
  if (req.query.confirm !== 'replace') {
    return sendError(res, 422, 'restore.unconfirmed');
  }
  try {
    res.json(restoreBackup(req.body));
  } catch (err) {
    if (err instanceof BackupError) return sendError(res, 422, err.code, err.params);
    throw err;
  }
});

// Objects (houses, flats, ...) and their meters. Tanks belong to meters.

app.get('/api/objects', (_req, res) => {
  res.json(stmt.objects.all());
});

app.post('/api/objects', (req, res) => {
  const body = req.body ?? {};
  const error = nameError(body.name);
  if (error) return sendProblem(res, 422, error);
  const info = stmt.insertObject.run(body.name.trim());
  res.status(201).json(stmt.objectById.get(Number(info.lastInsertRowid)));
});

app.put('/api/objects/:id', (req, res) => {
  const object = objectOr404(Number(req.params.id), res);
  if (!object) return;
  const name = req.body?.name ?? object.name;
  const error = nameError(name);
  if (error) return sendProblem(res, 422, error);
  stmt.updateObject.run(name.trim(), object.id);
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
  let error =
    nameError(body.name) ??
    (METER_KINDS.includes(body.kind) ? null : problem('meter.kind')) ??
    serialError(body.serial, body.kind) ??
    tankError(body.tank_size ?? null, body.kind) ??
    tankUnitError(body.tank_unit, body.kind) ??
    densityError(body.tank_density, body.kind);
  let subOf = null;
  if (!error && body.sub_of != null) {
    const parent = isId(body.sub_of) ? stmt.meterById.get(body.sub_of) : null;
    if (!parent || parent.object_id !== object.id || parent.kind !== 'water' || parent.sub_of != null) {
      error = problem('meter.subNeedsWater');
    } else if (body.kind !== 'water') {
      error = problem('meter.subOnlyWater');
    }
    subOf = parent?.id ?? null;
  }
  if (error) return sendProblem(res, 422, error);
  const info = stmt.insertMeter.run(
    object.id,
    body.kind,
    body.name.trim(),
    subOf,
    body.serial?.trim() || null,
    body.tank_size ?? null,
    body.tank_unit ?? 'l',
    body.tank_density ?? null,
  );
  res.status(201).json(stmt.meterById.get(Number(info.lastInsertRowid)));
});

app.put('/api/meters/:id', (req, res) => {
  const meter = isId(Number(req.params.id)) ? stmt.meterById.get(Number(req.params.id)) : null;
  if (!meter) return sendError(res, 404, 'not_found');
  const body = req.body ?? {};
  const name = body.name ?? meter.name;
  const serial = body.serial !== undefined ? body.serial : meter.serial;
  const tankSize = body.tank_size !== undefined ? body.tank_size : meter.tank_size;
  const tankUnit = body.tank_unit !== undefined ? body.tank_unit : meter.tank_unit;
  const density = body.tank_density !== undefined ? body.tank_density : meter.tank_density;
  const error =
    nameError(name) ??
    serialError(serial, meter.kind) ??
    tankError(tankSize, meter.kind) ??
    tankUnitError(tankUnit, meter.kind) ??
    densityError(density, meter.kind);
  if (error) return sendProblem(res, 422, error);
  const hasEntries = stmt.tankEntries.get(meter.id, meter.id, meter.id).n > 0;
  if (tankSize == null && meter.tank_size != null && hasEntries) {
    return sendError(res, 422, 'tank.hasEntries');
  }
  if (tankUnit !== meter.tank_unit && hasEntries) {
    return sendError(res, 422, 'tankUnit.locked');
  }
  const highest = highestLevel(meter.id);
  if (tankSize != null && highest != null && tankSize < highest) {
    return sendError(res, 422, 'tankSize.belowLevel', { level: highest });
  }
  stmt.updateMeter.run(name.trim(), serial?.trim() || null, tankSize, tankUnit, density, meter.id);
  res.json(stmt.meterById.get(meter.id));
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
    return sendError(res, 422, 'readings.onePerMeter');
  }
  for (const [index, item] of items.entries()) {
    const meter = isId(item?.meter_id) ? stmt.meterById.get(item.meter_id) : null;
    const error = !meter
      ? problem('meter.unknown')
      : validateReading(item, meter) ?? checkMonotonic(meter.id, item.read_at, item.meter);
    if (error) {
      if (!isBatch) return sendProblem(res, 422, error);
      return sendError(res, 422, 'reading.entry', { index: index + 1, cause: error });
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
      return sendError(res, 409, 'reading.duplicate');
    }
    throw err;
  }
});

app.delete('/api/readings/:id', removeById(stmt.removeReading));

// Tanks: refills and gauge values belong to a tank meter (oil, or gas with a tank).

// Returns the meter when it can hold a tank, otherwise responds with an error and returns null.
function tankMeterOr422(id, res) {
  const meter = isId(id) ? stmt.meterById.get(id) : null;
  if (!meter) {
    sendError(res, 404, 'meter.notFound');
    return null;
  }
  if (!isTankMeter(meter)) {
    sendError(res, 422, 'meter.noTank');
    return null;
  }
  return meter;
}

app.get('/api/objects/:id/tank-levels', (req, res) => {
  if (!objectOr404(Number(req.params.id), res)) return;
  res.json(stmt.tankLevelsOf.all(Number(req.params.id)));
});

app.post('/api/meters/:id/tank-levels', (req, res) => {
  const meter = tankMeterOr422(Number(req.params.id), res);
  if (!meter) return;
  const body = req.body ?? {};
  const error = validateTankLevel(body, meter.tank_size);
  if (error) return sendProblem(res, 422, error);
  try {
    const info = stmt.insertTankLevel.run(meter.id, body.read_at, body.level, (body.note ?? '').trim());
    res.status(201).json(stmt.tankLevelById.get(Number(info.lastInsertRowid)));
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      return sendError(res, 409, 'tankLevel.duplicate');
    }
    throw err;
  }
});

app.delete('/api/tank-levels/:id', removeById(stmt.removeTankLevel));

app.get('/api/objects/:id/refills', (req, res) => {
  if (!objectOr404(Number(req.params.id), res)) return;
  res.json(stmt.refillsOf.all(Number(req.params.id)));
});

app.post('/api/meters/:id/refills', (req, res) => {
  const meter = tankMeterOr422(Number(req.params.id), res);
  if (!meter) return;
  const body = req.body ?? {};
  const error =
    validateRefill(body, meter.tank_size) ??
    (body.meter == null ? null : checkMonotonic(meter.id, body.filled_at, body.meter));
  if (error) return sendProblem(res, 422, error);
  const info = stmt.insertRefill.run(
    meter.id,
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

app.use('/api', (_req, res) => sendError(res, 404, 'not_found'));

if (config.nodeEnv === 'production') {
  app.use(express.static(path.join(root, 'dist')));
  app.get('/{*splat}', (_req, res) => res.sendFile(path.join(root, 'dist', 'index.html')));
}

app.use((err, _req, res, _next) => {
  if (err.status >= 400 && err.status < 500) {
    return sendError(res, err.status, 'request.invalid');
  }
  console.error(err);
  sendError(res, 500, 'server.error');
});
