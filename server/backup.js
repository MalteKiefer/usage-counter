import { db } from './db.js';
import { isId } from './validation.js';
import { isTankMeter } from '../src/lib/meters.js';
import {
  nameError,
  problem,
  neighbourError,
  serialError,
  tankError,
  tankUnitError,
  densityError,
  validateReading,
  validateRefill,
  validateTankLevel,
} from './rules.js';

export const BACKUP_FORMAT = 'usage-counter-backup';
// Version 2 keeps the tank on the meter. Version 1 (tank on the object) is converted on restore.
export const BACKUP_VERSION = 2;

const METER_KINDS = ['oil', 'water', 'power', 'gas'];

// Carries a code and its values, like the validators do, so the client can translate it.
export class BackupError extends Error {
  constructor(code, params) {
    super(code);
    this.code = code;
    this.params = params;
  }
}

const fail = (code, params) => {
  throw new BackupError(code, params);
};

const TABLES = ['objects', 'meters', 'readings', 'refills', 'tank_levels'];

const EXPORT_QUERIES = {
  objects: 'SELECT id, name FROM objects ORDER BY id',
  meters: 'SELECT id, object_id, kind, name, sub_of, serial, tank_size, tank_unit, tank_density FROM meters ORDER BY id',
  readings: 'SELECT id, meter_id, read_at, meter, tank_level, note FROM readings ORDER BY id',
  refills: 'SELECT id, meter_id, filled_at, meter, liters, total_eur, level_after, note FROM refills ORDER BY id',
  tank_levels: 'SELECT id, meter_id, read_at, level, note FROM tank_levels ORDER BY id',
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
  if (!Array.isArray(rows)) fail('backup.tableMissing', { table });
  rows.forEach((row, index) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) fail('backup.rowNotObject', { table, index });
  });
  return rows;
}

function checkIds(rows, table) {
  const seen = new Set();
  for (const row of rows) {
    if (!isId(row.id) || seen.has(row.id)) fail('backup.id', { table, id: row.id });
    seen.add(row.id);
  }
}

// Runs the same rules as the API for every row. The restore must not accept what the API refuses.
function checkRows(rows, table, check) {
  for (const row of rows) {
    const error = check(row);
    if (error) fail('backup.row', { table, id: row.id, cause: error });
  }
}

// Version 1 kept the tank on the object and its refills and gauge values on the object.
// Each object's tank goes to its oil meter (the lowest id), which is created when it has none.
export function upgradeV1(body) {
  const data = body.data;
  const isRow = (row) => row !== null && typeof row === 'object' && !Array.isArray(row);
  // Tables that are not lists of rows are passed on unchanged, so parseBackup reports them.
  const rowsOf = (table) => (Array.isArray(data[table]) && data[table].every(isRow) ? data[table] : null);
  const objects = rowsOf('objects');
  const meters = rowsOf('meters');
  const refills = rowsOf('refills');
  const levels = rowsOf('tank_levels');
  if (!objects || !meters || !refills || !levels) {
    return { format: body.format, version: BACKUP_VERSION, data };
  }

  const converted = meters.map((m) => ({ tank_size: null, ...m }));
  const oilOf = new Map();
  const oilByObject = new Map();
  for (const m of converted) {
    if (m.kind !== 'oil') continue;
    const first = oilByObject.get(m.object_id);
    if (!first || m.id < first.id) oilByObject.set(m.object_id, m);
  }
  const tankObjects = new Set([...refills, ...levels].map((row) => row.object_id));
  let nextId = converted.reduce((max, m) => (isId(m.id) && m.id > max ? m.id : max), 0) + 1;
  for (const object of objects) {
    let oil = oilByObject.get(object.id);
    if (!oil && (object.tank_size != null || tankObjects.has(object.id))) {
      oil = { id: nextId++, object_id: object.id, kind: 'oil', name: 'Heizöl', sub_of: null, serial: null, tank_size: null };
      converted.push(oil);
    }
    if (oil) {
      oilOf.set(object.id, oil);
      if (oil.tank_size === null) oil.tank_size = object.tank_size ?? null;
    }
  }
  const toMeter = (row) => {
    const { object_id: objectId, ...rest } = row;
    return { ...rest, meter_id: oilOf.get(objectId)?.id ?? null };
  };
  return {
    format: body.format,
    version: BACKUP_VERSION,
    data: {
      objects: objects.map(({ tank_size: _ignored, ...o }) => o),
      meters: converted,
      readings: data.readings,
      refills: refills.map(toMeter),
      tank_levels: levels.map(toMeter),
    },
  };
}

// Checks every row and every reference before anything is written.
export function parseBackup(input) {
  if (!input || typeof input !== 'object' || input.format !== BACKUP_FORMAT) {
    fail('backup.notBackup');
  }
  const body = input.version === 1 && input.data && typeof input.data === 'object' ? upgradeV1(input) : input;
  if (body.version !== BACKUP_VERSION) fail('backup.version', { version: body.version });
  const data = body.data;
  if (!data || typeof data !== 'object') fail('backup.noData');
  for (const table of TABLES) rowsOf(data, table);

  const objects = data.objects;
  checkIds(objects, 'objects');
  checkRows(objects, 'objects', (o) => nameError(o.name));
  const objectIds = new Set(objects.map((o) => o.id));

  const meters = data.meters;
  checkIds(meters, 'meters');
  const meterById = new Map(meters.map((m) => [m.id, m]));
  checkRows(meters, 'meters', (m) => {
    if (!objectIds.has(m.object_id)) return problem('backup.missingRef', { ref: 'object', id: m.object_id });
    if (!METER_KINDS.includes(m.kind)) return problem('meter.kind');
    return (
      nameError(m.name) ??
      serialError(m.serial, m.kind) ??
      tankError(m.tank_size ?? null, m.kind) ??
      tankUnitError(m.tank_unit, m.kind) ??
      densityError(m.tank_density, m.kind)
    );
  });
  for (const m of meters) {
    if (m.sub_of == null) continue;
    const parent = meterById.get(m.sub_of);
    if (!parent || parent.kind !== 'water' || parent.sub_of != null || parent.object_id !== m.object_id || m.kind !== 'water') {
      fail('backup.row', { table: 'meters', id: m.id, cause: problem('meter.subNeedsWater') });
    }
  }

  const readings = data.readings;
  checkIds(readings, 'readings');
  checkRows(readings, 'readings', (r) => {
    const meter = meterById.get(r.meter_id);
    if (!meter) return problem('backup.missingRef', { ref: 'meter', id: r.meter_id });
    return validateReading(r, meter);
  });
  const readingKeys = new Set(readings.map((r) => `${r.meter_id}|${r.read_at}`));
  if (readingKeys.size !== readings.length) fail('backup.duplicate', { table: 'readings' });
  const series = seriesByMeter(readings);
  checkSeries(series);

  // A tank that is kept has to hold every level already recorded for it, like the API requires.
  const highest = new Map();
  const noteLevel = (meterId, level) => {
    if (level != null) highest.set(meterId, Math.max(highest.get(meterId) ?? -Infinity, level));
  };
  for (const f of data.refills) noteLevel(f.meter_id, f.level_after);
  for (const r of readings) noteLevel(r.meter_id, r.tank_level);
  for (const l of data.tank_levels) noteLevel(l.meter_id, l.level);
  for (const m of meters) {
    const max = highest.get(m.id);
    if (m.tank_size != null && max != null && m.tank_size < max) {
      fail('backup.row', { table: 'meters', id: m.id, cause: problem('tankSize.belowLevel', { level: max }) });
    }
  }

  const refills = data.refills;
  checkIds(refills, 'refills');
  checkRows(refills, 'refills', (f) => {
    const meter = meterById.get(f.meter_id);
    if (!meter) return problem('backup.missingRef', { ref: 'meter', id: f.meter_id });
    if (!isTankMeter(meter)) return problem('meter.noTank');
    return validateRefill(f, meter.tank_size);
  });
  for (const f of refills) {
    if (f.meter == null) continue;
    const meterSeries = series.get(f.meter_id) ?? [];
    const prev = meterSeries.filter((r) => r.read_at < f.filled_at).at(-1) ?? null;
    const next = meterSeries.find((r) => r.read_at > f.filled_at) ?? null;
    const error = neighbourError(prev, next, f.meter);
    if (error) fail('backup.row', { table: 'refills', id: f.id, cause: error });
  }

  const levels = data.tank_levels;
  checkIds(levels, 'tank_levels');
  checkRows(levels, 'tank_levels', (l) => {
    const meter = meterById.get(l.meter_id);
    if (!meter) return problem('backup.missingRef', { ref: 'meter', id: l.meter_id });
    if (!isTankMeter(meter)) return problem('meter.noTank');
    return validateTankLevel(l, meter.tank_size);
  });
  const levelKeys = new Set(levels.map((l) => `${l.meter_id}|${l.read_at}`));
  if (levelKeys.size !== levels.length) fail('backup.duplicate', { table: 'tank_levels' });

  return data;
}

// Backups list rows by id, not by time, so each meter's readings are put in time order first.
function seriesByMeter(readings) {
  const byMeter = new Map();
  for (const r of readings) {
    const series = byMeter.get(r.meter_id);
    if (series) series.push(r);
    else byMeter.set(r.meter_id, [r]);
  }
  for (const series of byMeter.values()) {
    series.sort((a, b) => (a.read_at < b.read_at ? -1 : a.read_at > b.read_at ? 1 : 0));
  }
  return byMeter;
}

function checkSeries(byMeter) {
  for (const series of byMeter.values()) {
    for (let i = 1; i < series.length; i++) {
      if (series[i].meter < series[i - 1].meter) {
        fail('backup.row', {
          table: 'readings',
          id: series[i].id,
          cause: neighbourError(series[i - 1], null, series[i].meter),
        });
      }
    }
  }
}

// Replaces all data with the backup in one transaction. Nothing changes if any step fails.
export function restoreBackup(body) {
  const data = parseBackup(body);
  const insertObject = db.prepare('INSERT INTO objects (id, name) VALUES (?, ?)');
  const insertMeter = db.prepare(
    'INSERT INTO meters (id, object_id, kind, name, sub_of, serial, tank_size, tank_unit, tank_density) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  );
  const insertReading = db.prepare(
    'INSERT INTO readings (id, meter_id, read_at, meter, tank_level, note) VALUES (?, ?, ?, ?, ?, ?)',
  );
  const insertRefill = db.prepare(
    'INSERT INTO refills (id, meter_id, filled_at, meter, liters, total_eur, level_after, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  );
  const insertLevel = db.prepare('INSERT INTO tank_levels (id, meter_id, read_at, level, note) VALUES (?, ?, ?, ?, ?)');

  db.exec('BEGIN');
  try {
    db.exec('DELETE FROM readings; DELETE FROM refills; DELETE FROM tank_levels; DELETE FROM meters; DELETE FROM objects;');
    for (const o of data.objects) insertObject.run(o.id, o.name.trim());
    // Garden meters point at their water meter, so parents go first.
    const meters = [...data.meters.filter((m) => m.sub_of == null), ...data.meters.filter((m) => m.sub_of != null)];
    for (const m of meters) {
      insertMeter.run(
        m.id,
        m.object_id,
        m.kind,
        m.name.trim(),
        m.sub_of ?? null,
        m.serial?.trim() || null,
        m.tank_size ?? null,
        m.tank_unit ?? 'l',
        m.tank_density ?? null,
      );
    }
    for (const r of data.readings) {
      insertReading.run(r.id, r.meter_id, r.read_at, r.meter, r.tank_level ?? null, r.note ?? '');
    }
    for (const f of data.refills) {
      insertRefill.run(f.id, f.meter_id, f.filled_at, f.meter ?? null, f.liters, f.total_eur ?? null, f.level_after ?? null, f.note ?? '');
    }
    for (const l of data.tank_levels) insertLevel.run(l.id, l.meter_id, l.read_at, l.level, l.note ?? '');
    db.exec('COMMIT');
  } catch (err) {
    if (db.isTransaction) db.exec('ROLLBACK');
    if (err instanceof BackupError) throw err;
    console.error(err);
    throw new BackupError('backup.failed');
  }

  return {
    objects: data.objects.length,
    meters: data.meters.length,
    readings: data.readings.length,
    refills: data.refills.length,
    tankLevels: data.tank_levels.length,
  };
}
