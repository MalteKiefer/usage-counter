import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';

export const db = new DatabaseSync(config.dbPath);

db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS objects (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    name      TEXT    NOT NULL CHECK (length(name) BETWEEN 1 AND 100)
  );

  CREATE TABLE IF NOT EXISTS meters (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    object_id INTEGER NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
    kind      TEXT    NOT NULL CHECK (kind IN ('oil', 'water', 'power', 'gas')),
    name      TEXT    NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
    sub_of    INTEGER REFERENCES meters(id) ON DELETE CASCADE, -- garden meter behind a water meter
    serial    TEXT    CHECK (serial IS NULL OR length(serial) BETWEEN 1 AND 50), -- meter number
    tank_size REAL    CHECK (tank_size IS NULL OR tank_size > 0), -- oil tank or gas tank (LPG)
    tank_unit TEXT    NOT NULL DEFAULT 'l' CHECK (tank_unit IN ('l', 'kg')), -- unit of tank size, refills and gauge values
    tank_density REAL CHECK (tank_density IS NULL OR tank_density BETWEEN 0.3 AND 1), -- kg per litre, gas only
    CHECK (sub_of IS NULL OR kind = 'water'),
    CHECK (tank_size IS NULL OR kind IN ('oil', 'gas'))
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
    meter_id    INTEGER NOT NULL REFERENCES meters(id) ON DELETE CASCADE, -- the tank
    filled_at   TEXT    NOT NULL,
    meter       REAL    CHECK (meter IS NULL OR meter >= 0),
    liters      REAL    NOT NULL CHECK (liters > 0),
    total_eur   REAL    CHECK (total_eur IS NULL OR total_eur >= 0),
    level_after REAL    CHECK (level_after IS NULL OR level_after >= 0), -- NULL means tank was filled full
    note        TEXT    NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS tank_levels (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    meter_id  INTEGER NOT NULL REFERENCES meters(id) ON DELETE CASCADE, -- the tank
    read_at   TEXT    NOT NULL,
    level     REAL    NOT NULL CHECK (level >= 0),
    note      TEXT    NOT NULL DEFAULT '',
    UNIQUE (meter_id, read_at)
  );

  -- Accounts exist only when OIDC is enabled. Preferences are stored as JSON per account.
  CREATE TABLE IF NOT EXISTS users (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    issuer  TEXT    NOT NULL,
    sub     TEXT    NOT NULL,
    email   TEXT    NOT NULL,
    name    TEXT    NOT NULL,
    picture TEXT,                               -- data URL, copied once at sign-in
    prefs   TEXT    NOT NULL DEFAULT '{}',
    UNIQUE (issuer, sub)
  );

  -- Only a SHA-256 hash of the session token is stored, never the token itself.
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT    PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL                 -- epoch milliseconds
  );

  -- State, nonce and PKCE verifier of a sign-in in progress; each is used once.
  CREATE TABLE IF NOT EXISTS login_states (
    state      TEXT    PRIMARY KEY,
    nonce      TEXT    NOT NULL,
    verifier   TEXT    NOT NULL,
    created_at INTEGER NOT NULL                 -- epoch milliseconds
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
    throw new Error('readings has no channel column: migrate with an older version that uses channels first');
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

const sequenceOf = (table) =>
  db.prepare('SELECT seq FROM sqlite_sequence WHERE name = ?').get(table)?.seq ?? 0;

// Tanks belong to meters now: gas meters can have a tank, and refills and gauge values point at the tank meter.
// Objects with tank data but no oil meter get one, so no refill or gauge value is lost.
// SQLite cannot change CHECK constraints or drop referenced columns, so the tables are rebuilt.
// Foreign keys stay off during the rebuild, otherwise dropping meters would delete their readings.
function migrateToMeterTanks() {
  if (!tableNames().includes('meters') || columnNames('meters').includes('tank_size')) return;
  const hasRefills = tableNames().includes('refills');
  const hasLevels = tableNames().includes('tank_levels');
  const hasObjectTank = columnNames('objects').includes('tank_size');
  const hasSerial = columnNames('meters').includes('serial');
  const seqs = Object.fromEntries(['meters', 'refills', 'tank_levels'].map((t) => [t, sequenceOf(t)]));

  db.exec('PRAGMA foreign_keys = OFF');
  try {
    db.exec('BEGIN');
    if (hasObjectTank) {
      db.exec(`
        INSERT INTO meters (object_id, kind, name)
          SELECT o.id, 'oil', 'Heizöl' FROM objects o
          WHERE (o.tank_size IS NOT NULL
            ${hasRefills ? 'OR EXISTS (SELECT 1 FROM refills f WHERE f.object_id = o.id)' : ''}
            ${hasLevels ? 'OR EXISTS (SELECT 1 FROM tank_levels t WHERE t.object_id = o.id)' : ''})
          AND NOT EXISTS (SELECT 1 FROM meters m WHERE m.object_id = o.id AND m.kind = 'oil');
      `);
    }
    db.exec(`
      CREATE TABLE objects_new (
        id   INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT    NOT NULL CHECK (length(name) BETWEEN 1 AND 100)
      );
      INSERT INTO objects_new (id, name) SELECT id, name FROM objects;
      CREATE TABLE meters_new (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        object_id INTEGER NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
        kind      TEXT    NOT NULL CHECK (kind IN ('oil', 'water', 'power', 'gas')),
        name      TEXT    NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
        sub_of    INTEGER REFERENCES meters(id) ON DELETE CASCADE,
        serial    TEXT    CHECK (serial IS NULL OR length(serial) BETWEEN 1 AND 50),
        tank_size REAL    CHECK (tank_size IS NULL OR tank_size > 0),
        CHECK (sub_of IS NULL OR kind = 'water'),
        CHECK (tank_size IS NULL OR kind IN ('oil', 'gas'))
      );
      INSERT INTO meters_new (id, object_id, kind, name, sub_of, serial, tank_size)
        SELECT m.id, m.object_id, m.kind, m.name, m.sub_of, ${hasSerial ? 'm.serial' : 'NULL'},
          ${hasObjectTank ? "CASE WHEN m.kind = 'oil' THEN (SELECT o.tank_size FROM objects o WHERE o.id = m.object_id) END" : 'NULL'}
        FROM meters m;
    `);
    if (hasRefills) {
      db.exec(`
        CREATE TABLE refills_new (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          meter_id    INTEGER NOT NULL REFERENCES meters(id) ON DELETE CASCADE,
          filled_at   TEXT    NOT NULL,
          meter       REAL    CHECK (meter IS NULL OR meter >= 0),
          liters      REAL    NOT NULL CHECK (liters > 0),
          total_eur   REAL    CHECK (total_eur IS NULL OR total_eur >= 0),
          level_after REAL    CHECK (level_after IS NULL OR level_after >= 0),
          note        TEXT    NOT NULL DEFAULT ''
        );
        INSERT INTO refills_new (id, meter_id, filled_at, meter, liters, total_eur, level_after, note)
          SELECT f.id, (SELECT m.id FROM meters_new m WHERE m.object_id = f.object_id AND m.kind = 'oil' ORDER BY m.id LIMIT 1),
            f.filled_at, f.meter, f.liters, f.total_eur, f.level_after, f.note
          FROM refills f;
      `);
    }
    if (hasLevels) {
      db.exec(`
        CREATE TABLE tank_levels_new (
          id        INTEGER PRIMARY KEY AUTOINCREMENT,
          meter_id  INTEGER NOT NULL REFERENCES meters(id) ON DELETE CASCADE,
          read_at   TEXT    NOT NULL,
          level     REAL    NOT NULL CHECK (level >= 0),
          note      TEXT    NOT NULL DEFAULT '',
          UNIQUE (meter_id, read_at)
        );
        INSERT INTO tank_levels_new (id, meter_id, read_at, level, note)
          SELECT t.id, (SELECT m.id FROM meters_new m WHERE m.object_id = t.object_id AND m.kind = 'oil' ORDER BY m.id LIMIT 1),
            t.read_at, t.level, t.note
          FROM tank_levels t;
      `);
    }
    db.exec(`
      ${hasRefills ? 'DROP TABLE refills;' : ''}
      ${hasLevels ? 'DROP TABLE tank_levels;' : ''}
      DROP TABLE meters;
      DROP TABLE objects;
      ALTER TABLE objects_new RENAME TO objects;
      ALTER TABLE meters_new RENAME TO meters;
      ${hasRefills ? 'ALTER TABLE refills_new RENAME TO refills;' : ''}
      ${hasLevels ? 'ALTER TABLE tank_levels_new RENAME TO tank_levels;' : ''}
    `);
    if (db.prepare('PRAGMA foreign_key_check').all().length > 0) {
      throw new Error('Tank migration violates a foreign key');
    }
    for (const [table, seq] of Object.entries(seqs)) {
      db.prepare("UPDATE sqlite_sequence SET seq = max(seq, ?) WHERE name = ?").run(seq, table);
    }
    db.exec('COMMIT');
  } catch (err) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw err;
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
}
migrateToMeterTanks();
// Gas tanks can be given in litres or kilograms. Adding the column keeps every row as litres.
if (tableNames().includes('meters') && !columnNames('meters').includes('tank_unit')) {
  db.exec("ALTER TABLE meters ADD COLUMN tank_unit TEXT NOT NULL DEFAULT 'l' CHECK (tank_unit IN ('l', 'kg'))");
}
if (tableNames().includes('meters') && !columnNames('meters').includes('tank_density')) {
  db.exec('ALTER TABLE meters ADD COLUMN tank_density REAL CHECK (tank_density IS NULL OR tank_density BETWEEN 0.3 AND 1)');
}
db.exec(SCHEMA);
