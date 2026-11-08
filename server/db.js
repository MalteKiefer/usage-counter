import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const dbPath = process.env.OIL_DB ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'oil.db');

export const db = new DatabaseSync(dbPath);

db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS objects (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    name      TEXT    NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
    tank_size REAL    CHECK (tank_size IS NULL OR tank_size > 0)
  );

  CREATE TABLE IF NOT EXISTS meters (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    object_id INTEGER NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
    kind      TEXT    NOT NULL CHECK (kind IN ('oil', 'water', 'power')),
    name      TEXT    NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
    sub_of    INTEGER REFERENCES meters(id) ON DELETE CASCADE, -- garden meter behind a water meter
    CHECK (sub_of IS NULL OR kind = 'water')
  );

  CREATE TABLE IF NOT EXISTS readings (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    meter_id   INTEGER NOT NULL REFERENCES meters(id) ON DELETE CASCADE,
    read_at    TEXT    NOT NULL,                                       -- local time, YYYY-MM-DDTHH:MM
    meter      REAL    NOT NULL CHECK (meter >= 0),                    -- in the unit of the meter
    tank_level REAL    CHECK (tank_level IS NULL OR tank_level >= 0),  -- gauge at the oil tank
    note       TEXT    NOT NULL DEFAULT '',
    UNIQUE (meter_id, read_at)
  );

  CREATE TABLE IF NOT EXISTS refills (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    object_id   INTEGER NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
    filled_at   TEXT    NOT NULL,
    meter       REAL    CHECK (meter IS NULL OR meter >= 0),
    liters      REAL    NOT NULL CHECK (liters > 0),
    total_eur   REAL    CHECK (total_eur IS NULL OR total_eur >= 0),
    level_after REAL    CHECK (level_after IS NULL OR level_after >= 0), -- NULL means tank was filled full
    note        TEXT    NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS tank_levels (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    object_id INTEGER NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
    read_at   TEXT    NOT NULL,
    level     REAL    NOT NULL CHECK (level >= 0),
    note      TEXT    NOT NULL DEFAULT '',
    UNIQUE (object_id, read_at)
  );

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value REAL NOT NULL
  );
`;

const tableNames = () => db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((t) => t.name);
const columnNames = (table) => db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);

// Databases from the single-object version: one object, meters by former channel, rows moved over.
function migrateSingleObject() {
  if (!columnNames('readings').includes('channel')) {
    throw new Error('readings ohne Spalte channel: bitte mit einer älteren Version auf Channels migrieren');
  }
  const refillMeter = columnNames('refills').includes('meter') ? 'meter' : 'NULL';
  db.exec('BEGIN');
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value REAL NOT NULL);
      CREATE TABLE objects (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        name      TEXT    NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
        tank_size REAL    CHECK (tank_size IS NULL OR tank_size > 0)
      );
      INSERT INTO objects (id, name, tank_size)
        VALUES (1, 'Haus', (SELECT value FROM settings WHERE key = 'tank_size'));
    `);
    db.exec(`
      CREATE TABLE meters (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        object_id INTEGER NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
        kind      TEXT    NOT NULL CHECK (kind IN ('oil', 'water', 'power')),
        name      TEXT    NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
        sub_of    INTEGER REFERENCES meters(id) ON DELETE CASCADE,
        CHECK (sub_of IS NULL OR kind = 'water')
      );
      INSERT INTO meters (object_id, kind, name)
        SELECT 1, 'oil', 'Heizöl' WHERE EXISTS (SELECT 1 FROM readings WHERE channel = 'oil');
      INSERT INTO meters (object_id, kind, name)
        SELECT 1, 'water', 'Wasser' WHERE EXISTS (SELECT 1 FROM readings WHERE channel = 'water');
      INSERT INTO meters (object_id, kind, name, sub_of)
        SELECT 1, 'water', 'Gartenzähler', (SELECT id FROM meters WHERE object_id = 1 AND kind = 'water')
        WHERE EXISTS (SELECT 1 FROM readings WHERE channel = 'garden');
      INSERT INTO meters (object_id, kind, name)
        SELECT 1, 'power', 'Strom' WHERE EXISTS (SELECT 1 FROM readings WHERE channel = 'power');
    `);
    db.exec(`
      CREATE TABLE readings_new (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        meter_id   INTEGER NOT NULL REFERENCES meters(id) ON DELETE CASCADE,
        read_at    TEXT    NOT NULL,
        meter      REAL    NOT NULL CHECK (meter >= 0),
        tank_level REAL    CHECK (tank_level IS NULL OR tank_level >= 0),
        note       TEXT    NOT NULL DEFAULT '',
        UNIQUE (meter_id, read_at)
      );
      INSERT INTO readings_new (id, meter_id, read_at, meter, tank_level, note)
        SELECT r.id,
          CASE r.channel
            WHEN 'oil' THEN (SELECT id FROM meters WHERE object_id = 1 AND kind = 'oil')
            WHEN 'water' THEN (SELECT id FROM meters WHERE object_id = 1 AND kind = 'water' AND sub_of IS NULL)
            WHEN 'garden' THEN (SELECT id FROM meters WHERE object_id = 1 AND sub_of IS NOT NULL)
            WHEN 'power' THEN (SELECT id FROM meters WHERE object_id = 1 AND kind = 'power')
          END,
          r.read_at, r.meter, r.tank_level, r.note
        FROM readings r;
      DROP TABLE readings;
      ALTER TABLE readings_new RENAME TO readings;
    `);
    db.exec(`
      CREATE TABLE refills_new (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        object_id   INTEGER NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
        filled_at   TEXT    NOT NULL,
        meter       REAL    CHECK (meter IS NULL OR meter >= 0),
        liters      REAL    NOT NULL CHECK (liters > 0),
        total_eur   REAL    CHECK (total_eur IS NULL OR total_eur >= 0),
        level_after REAL    CHECK (level_after IS NULL OR level_after >= 0),
        note        TEXT    NOT NULL DEFAULT ''
      );
      INSERT INTO refills_new (id, object_id, filled_at, meter, liters, total_eur, level_after, note)
        SELECT id, 1, filled_at, ${refillMeter}, liters, total_eur, level_after, note FROM refills;
      DROP TABLE refills;
      ALTER TABLE refills_new RENAME TO refills;
      CREATE TABLE tank_levels_new (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        object_id INTEGER NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
        read_at   TEXT    NOT NULL,
        level     REAL    NOT NULL CHECK (level >= 0),
        note      TEXT    NOT NULL DEFAULT '',
        UNIQUE (object_id, read_at)
      );
      INSERT INTO tank_levels_new (id, object_id, read_at, level, note)
        SELECT id, 1, read_at, level, note FROM tank_levels;
      DROP TABLE tank_levels;
      ALTER TABLE tank_levels_new RENAME TO tank_levels;
    `);
    db.exec('COMMIT');
  } catch (err) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw err;
  }
}

if (tableNames().includes('readings') && !tableNames().includes('objects')) {
  migrateSingleObject();
}
db.exec(SCHEMA);
