import { db } from './db.js';
import { isId } from './validation.js';
import {
  nameError,
  neighbourError,
  tankSizeError,
  validateReading,
  validateRefill,
  validateTankLevel,
} from './rules.js';

export const BACKUP_FORMAT = 'usage-counter-backup';
export const BACKUP_VERSION = 1;

const METER_KINDS = ['oil', 'water', 'power'];

export class BackupError extends Error {}

const fail = (message) => {
  throw new BackupError(message);
};

const TABLES = ['objects', 'meters', 'readings', 'refills', 'tank_levels'];

const EXPORT_QUERIES = {
  objects: 'SELECT id, name, tank_size FROM objects ORDER BY id',
  meters: 'SELECT id, object_id, kind, name, sub_of FROM meters ORDER BY id',
  readings: 'SELECT id, meter_id, read_at, meter, tank_level, note FROM readings ORDER BY id',
  refills: 'SELECT id, object_id, filled_at, meter, liters, total_eur, level_after, note FROM refills ORDER BY id',
  tank_levels: 'SELECT id, object_id, read_at, level, note FROM tank_levels ORDER BY id',
};

// The whole database as one JSON document. Ids are kept, so references stay valid on restore.
export function exportBackup() {
  const data = {};
  for (const [table, sql] of Object.entries(EXPORT_QUERIES)) {
    data[table] = db.prepare(sql).all().map((row) => ({ ...row }));
  }
  return { format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: new Date().toISOString(), data };
}

// Every entry must be a plain object, otherwise field access would fail with a server error.
function rowsOf(data, table) {
  const rows = data[table];
  if (!Array.isArray(rows)) fail(`${table} fehlt`);
  rows.forEach((row, index) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) fail(`${table}[${index}] ist kein Objekt`);
  });
  return rows;
}

// Ids must be unique positive integers within their table.
function checkIds(rows, table) {
  const seen = new Set();
  for (const row of rows) {
    if (!isId(row.id) || seen.has(row.id)) fail(`${table}: ungültige oder doppelte id ${row.id}`);
    seen.add(row.id);
  }
}

// Runs the same rules as the API for every row. The restore must not accept what the API refuses.
function checkRows(rows, table, check) {
  for (const row of rows) {
    const error = check(row);
    if (error) fail(`${table} ${row.id}: ${error}`);
  }
}

// Checks every row and every reference before anything is written.
export function parseBackup(body) {
  if (!body || typeof body !== 'object' || body.format !== BACKUP_FORMAT) {
    fail('Keine Usage-Counter-Sicherung');
  }
  if (body.version !== BACKUP_VERSION) fail(`Version ${body.version} wird nicht unterstützt`);
  const data = body.data;
  if (!data || typeof data !== 'object') fail('Daten fehlen');
  for (const table of TABLES) rowsOf(data, table);

  const objects = data.objects;
  checkIds(objects, 'objects');
  checkRows(objects, 'objects', (o) => nameError(o.name) ?? tankSizeError(o.tank_size ?? null));
  const tankSizes = new Map(objects.map((o) => [o.id, o.tank_size ?? null]));

  const meters = data.meters;
  checkIds(meters, 'meters');
  const meterById = new Map(meters.map((m) => [m.id, m]));
  checkRows(meters, 'meters', (m) => {
    if (!tankSizes.has(m.object_id)) return `Objekt ${m.object_id} fehlt`;
    if (!METER_KINDS.includes(m.kind)) return 'Zählerart ungültig';
    return nameError(m.name);
  });
  for (const m of meters) {
    if (m.sub_of == null) continue;
    const parent = meterById.get(m.sub_of);
    if (!parent || parent.kind !== 'water' || parent.sub_of != null || parent.object_id !== m.object_id || m.kind !== 'water') {
      fail(`meters ${m.id}: Untermesser verweist auf keinen passenden Wasserzähler`);
    }
  }

  const readings = data.readings;
  checkIds(readings, 'readings');
  checkRows(readings, 'readings', (r) => {
    const meter = meterById.get(r.meter_id);
    if (!meter) return `Zähler ${r.meter_id} fehlt`;
    return validateReading(r, meter, tankSizes.get(meter.object_id));
  });
  const readingKeys = new Set(readings.map((r) => `${r.meter_id}|${r.read_at}`));
  if (readingKeys.size !== readings.length) fail('readings: doppelte Ablesung');
  checkSeries(readings);

  const refills = data.refills;
  checkIds(refills, 'refills');
  checkRows(refills, 'refills', (f) => {
    if (!tankSizes.has(f.object_id)) return `Objekt ${f.object_id} fehlt`;
    return validateRefill(f, tankSizes.get(f.object_id));
  });
  // A refill meter value must fit between the oil readings around it, like a reading does.
  for (const f of refills) {
    if (f.meter == null) continue;
    const oil = meters.find((m) => m.object_id === f.object_id && m.kind === 'oil');
    if (!oil) continue;
    const series = readings.filter((r) => r.meter_id === oil.id);
    const prev = series.filter((r) => r.read_at < f.filled_at).at(-1) ?? null;
    const next = series.find((r) => r.read_at > f.filled_at) ?? null;
    const error = neighbourError(prev, next, f.meter);
    if (error) fail(`refills ${f.id}: ${error}`);
  }

  const levels = data.tank_levels;
  checkIds(levels, 'tank_levels');
  checkRows(levels, 'tank_levels', (l) => {
    if (!tankSizes.has(l.object_id)) return `Objekt ${l.object_id} fehlt`;
    return validateTankLevel(l, tankSizes.get(l.object_id));
  });
  const levelKeys = new Set(levels.map((l) => `${l.object_id}|${l.read_at}`));
  if (levelKeys.size !== levels.length) fail('tank_levels: doppelter Wert');

  return data;
}

// Meter values of one meter must not decrease over time.
function checkSeries(readings) {
  const byMeter = new Map();
  for (const r of readings) {
    byMeter.set(r.meter_id, [...(byMeter.get(r.meter_id) ?? []), r]);
  }
  for (const series of byMeter.values()) {
    series.sort((a, b) => (a.read_at < b.read_at ? -1 : a.read_at > b.read_at ? 1 : 0));
    for (let i = 1; i < series.length; i++) {
      if (series[i].meter < series[i - 1].meter) {
        fail(`readings ${series[i].id}: ${neighbourError(series[i - 1], null, series[i].meter)}`);
      }
    }
  }
}

// Replaces all data with the backup in one transaction. Nothing changes if any step fails.
export function restoreBackup(body) {
  const data = parseBackup(body);
  const insertObject = db.prepare('INSERT INTO objects (id, name, tank_size) VALUES (?, ?, ?)');
  const insertMeter = db.prepare('INSERT INTO meters (id, object_id, kind, name, sub_of) VALUES (?, ?, ?, ?, ?)');
  const insertReading = db.prepare(
    'INSERT INTO readings (id, meter_id, read_at, meter, tank_level, note) VALUES (?, ?, ?, ?, ?, ?)',
  );
  const insertRefill = db.prepare(
    'INSERT INTO refills (id, object_id, filled_at, meter, liters, total_eur, level_after, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  );
  const insertLevel = db.prepare('INSERT INTO tank_levels (id, object_id, read_at, level, note) VALUES (?, ?, ?, ?, ?)');

  db.exec('BEGIN');
  try {
    db.exec('DELETE FROM readings; DELETE FROM meters; DELETE FROM refills; DELETE FROM tank_levels; DELETE FROM objects;');
    for (const o of data.objects) insertObject.run(o.id, o.name.trim(), o.tank_size ?? null);
    // Garden meters point at their water meter, so parents go first.
    const meters = [...data.meters.filter((m) => m.sub_of == null), ...data.meters.filter((m) => m.sub_of != null)];
    for (const m of meters) insertMeter.run(m.id, m.object_id, m.kind, m.name.trim(), m.sub_of ?? null);
    for (const r of data.readings) {
      insertReading.run(r.id, r.meter_id, r.read_at, r.meter, r.tank_level ?? null, r.note ?? '');
    }
    for (const f of data.refills) {
      insertRefill.run(f.id, f.object_id, f.filled_at, f.meter ?? null, f.liters, f.total_eur ?? null, f.level_after ?? null, f.note ?? '');
    }
    for (const l of data.tank_levels) insertLevel.run(l.id, l.object_id, l.read_at, l.level, l.note ?? '');
    db.exec('COMMIT');
  } catch (err) {
    if (db.isTransaction) db.exec('ROLLBACK');
    if (err instanceof BackupError) throw err;
    console.error(err);
    throw new BackupError('Wiederherstellung fehlgeschlagen, es wurde nichts geändert');
  }

  return {
    objects: data.objects.length,
    meters: data.meters.length,
    readings: data.readings.length,
    refills: data.refills.length,
    tankLevels: data.tank_levels.length,
  };
}
