import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-meters-'));
const file = path.join(dir, 'old.db');

// Meters before gas and serial numbers existed: the CHECK on kind allows only oil, water and power.
const old = new DatabaseSync(file);
old.exec(`
  PRAGMA foreign_keys = ON;
  CREATE TABLE objects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    tank_size REAL
  );
  CREATE TABLE meters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    object_id INTEGER NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('oil', 'water', 'power')),
    name TEXT NOT NULL,
    sub_of INTEGER REFERENCES meters(id) ON DELETE CASCADE,
    CHECK (sub_of IS NULL OR kind = 'water')
  );
  CREATE TABLE readings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    meter_id INTEGER NOT NULL REFERENCES meters(id) ON DELETE CASCADE,
    read_at TEXT NOT NULL,
    meter REAL NOT NULL,
    tank_level REAL,
    note TEXT NOT NULL DEFAULT '',
    UNIQUE (meter_id, read_at)
  );
  INSERT INTO objects (name, tank_size) VALUES ('Haus', 3000);
  CREATE TABLE refills (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    object_id INTEGER NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
    filled_at TEXT NOT NULL,
    meter REAL,
    liters REAL NOT NULL,
    total_eur REAL,
    level_after REAL,
    note TEXT NOT NULL DEFAULT ''
  );
  INSERT INTO refills (object_id, filled_at, liters) VALUES (1, '2020-01-03T08:00', 500);
  INSERT INTO meters (object_id, kind, name) VALUES (1, 'water', 'Wasser');
  INSERT INTO readings (meter_id, read_at, meter) VALUES (1, '2020-01-01T08:00', 50);
  DELETE FROM meters WHERE id = 1;
  INSERT INTO meters (object_id, kind, name) VALUES (1, 'water', 'Wasser neu');
`);
old.close();

process.env.DB_PATH = file;
const { db } = await import('./db.js');

after(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('migration keeps readings and accepts gas and serial numbers', () => {
  const water = db.prepare("SELECT id, name, serial FROM meters WHERE kind = 'water'").get();
  assert.deepEqual({ ...water }, { id: 2, name: 'Wasser neu', serial: null });
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM readings').get().n, 0);
  db.prepare("INSERT INTO meters (object_id, kind, name, serial) VALUES (1, 'gas', 'Gas', 'G-1')").run();
  assert.throws(() => db.prepare("INSERT INTO meters (object_id, kind, name) VALUES (1, 'coal', 'x')").run());
});

test('an object with a tank but no oil meter gets one, and its refills move to it', () => {
  const oil = db.prepare("SELECT id, name, tank_size, tank_unit FROM meters WHERE kind = 'oil'").get();
  assert.deepEqual({ ...oil }, { id: 3, name: 'Heizöl', tank_size: 3000, tank_unit: 'l' });
  assert.equal(db.prepare('SELECT meter_id FROM refills').get().meter_id, 3);
});

test('migrated meters still cascade their readings on delete', () => {
  db.prepare("INSERT INTO readings (meter_id, read_at, meter) VALUES (2, '2020-01-02T08:00', 60)").run();
  db.prepare('DELETE FROM meters WHERE id = 2').run();
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM readings').get().n, 0);
});
