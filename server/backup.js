import { db } from './db.js';
import { isId, isNumber, isOptionalNumber, isRealDateTime, DATE_TIME } from './validation.js';

export const BACKUP_FORMAT = 'usage-counter-backup';
export const BACKUP_VERSION = 1;

const METER_KINDS = ['oil', 'water', 'power'];
const MAX_VALUE = 100_000;

export class BackupError extends Error {}

const fail = (message) => {
  throw new BackupError(message);
};

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

const isName = (value) => typeof value === 'string' && value.trim().length >= 1 && value.length <= 100;
const isNote = (value) => value == null || (typeof value === 'string' && value.length <= 200);
const isDate = (value) => typeof value === 'string' && DATE_TIME.test(value) && isRealDateTime(value);

function uniqueIds(rows, table) {
  const seen = new Set();
  for (const row of rows) {
    if (!isId(row.id) || seen.has(row.id)) fail(`${table}: ungültige oder doppelte id ${row.id}`);
    seen.add(row.id);
  }
  return seen;
}

// Checks every row and every reference before anything is written.
export function parseBackup(body) {
  if (!body || typeof body !== 'object' || body.format !== BACKUP_FORMAT) {
    fail('Keine Usage-Counter-Sicherung');
  }
  if (body.version !== BACKUP_VERSION) fail(`Version ${body.version} wird nicht unterstützt`);
  const data = body.data;
  if (!data || typeof data !== 'object') fail('Daten fehlen');
  for (const table of Object.keys(EXPORT_QUERIES)) {
    if (!Array.isArray(data[table])) fail(`${table} fehlt`);
  }

  const objects = data.objects;
  for (const o of objects) {
    if (!isName(o.name)) fail(`objects ${o.id}: Name ungültig`);
    if (o.tank_size != null && (!isNumber(o.tank_size) || o.tank_size <= 0 || o.tank_size > MAX_VALUE)) {
      fail(`objects ${o.id}: Tankgröße ungültig`);
    }
  }
  const objectIds = uniqueIds(objects, 'objects');

  const meters = data.meters;
  const meterById = new Map();
  for (const m of meters) {
    if (!isId(m.id) || meterById.has(m.id)) fail(`meters: ungültige oder doppelte id ${m.id}`);
    meterById.set(m.id, m);
    if (!objectIds.has(m.object_id)) fail(`meters ${m.id}: Objekt ${m.object_id} fehlt`);
    if (!METER_KINDS.includes(m.kind)) fail(`meters ${m.id}: Zählerart ungültig`);
    if (!isName(m.name)) fail(`meters ${m.id}: Name ungültig`);
  }
  for (const m of meters) {
    if (m.sub_of == null) continue;
    const parent = meterById.get(m.sub_of);
    if (!parent || parent.kind !== 'water' || parent.sub_of != null || parent.object_id !== m.object_id || m.kind !== 'water') {
      fail(`meters ${m.id}: Untermesser verweist auf keinen passenden Wasserzähler`);
    }
  }

  const readings = data.readings;
  const readingKeys = new Set();
  uniqueIds(readings, 'readings');
  for (const r of readings) {
    const meter = meterById.get(r.meter_id);
    if (!meter) fail(`readings ${r.id}: Zähler ${r.meter_id} fehlt`);
    if (!isDate(r.read_at)) fail(`readings ${r.id}: Datum ungültig`);
    if (!isNumber(r.meter) || r.meter < 0) fail(`readings ${r.id}: Zählerstand ungültig`);
    if (r.tank_level != null && (meter.kind !== 'oil' || !isNumber(r.tank_level) || r.tank_level < 0)) {
      fail(`readings ${r.id}: Füllstand ungültig`);
    }
    if (!isNote(r.note)) fail(`readings ${r.id}: Notiz ungültig`);
    const key = `${r.meter_id}|${r.read_at}`;
    if (readingKeys.has(key)) fail(`readings ${r.id}: doppelte Ablesung`);
    readingKeys.add(key);
  }

  const refills = data.refills;
  uniqueIds(refills, 'refills');
  for (const f of refills) {
    if (!objectIds.has(f.object_id)) fail(`refills ${f.id}: Objekt ${f.object_id} fehlt`);
    if (!isDate(f.filled_at)) fail(`refills ${f.id}: Datum ungültig`);
    if (!isOptionalNumber(f.meter) || (f.meter ?? 0) < 0) fail(`refills ${f.id}: Zählerstand ungültig`);
    if (!isNumber(f.liters) || f.liters <= 0 || f.liters > MAX_VALUE) fail(`refills ${f.id}: Menge ungültig`);
    if (!isOptionalNumber(f.total_eur) || (f.total_eur ?? 0) < 0) fail(`refills ${f.id}: Preis ungültig`);
    if (!isOptionalNumber(f.level_after) || (f.level_after ?? 0) < 0) fail(`refills ${f.id}: Füllstand ungültig`);
    if (!isNote(f.note)) fail(`refills ${f.id}: Notiz ungültig`);
  }

  const levels = data.tank_levels;
  uniqueIds(levels, 'tank_levels');
  const levelKeys = new Set();
  for (const l of levels) {
    if (!objectIds.has(l.object_id)) fail(`tank_levels ${l.id}: Objekt ${l.object_id} fehlt`);
    if (!isDate(l.read_at)) fail(`tank_levels ${l.id}: Datum ungültig`);
    if (!isNumber(l.level) || l.level < 0) fail(`tank_levels ${l.id}: Füllstand ungültig`);
    if (!isNote(l.note)) fail(`tank_levels ${l.id}: Notiz ungültig`);
    const key = `${l.object_id}|${l.read_at}`;
    if (levelKeys.has(key)) fail(`tank_levels ${l.id}: doppelter Wert`);
    levelKeys.add(key);
  }

  return data;
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
