import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oil-migrate-'));
const file = path.join(dir, 'old.db');

// Schema of the single-object version: readings carry a channel, one tank size in settings.
const old = new DatabaseSync(file);
old.exec(`
  CREATE TABLE readings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    channel TEXT NOT NULL DEFAULT 'oil',
    read_at TEXT NOT NULL,
    meter REAL NOT NULL CHECK (meter >= 0),
    tank_level REAL,
    note TEXT NOT NULL DEFAULT '',
    UNIQUE (channel, read_at)
  );
  INSERT INTO readings (channel, read_at, meter, tank_level, note) VALUES
    ('oil', '2020-01-01T08:00', 1000, 500, 'a'),
    ('oil', '2020-01-03T08:00', 1100, NULL, ''),
    ('garden', '2020-01-01T08:00', 20, NULL, ''),
    ('water', '2020-01-01T08:00', 50, NULL, '');
  CREATE TABLE refills (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filled_at TEXT NOT NULL,
    meter REAL,
    liters REAL NOT NULL CHECK (liters > 0),
    total_eur REAL,
    level_after REAL,
    note TEXT NOT NULL DEFAULT ''
  );
  INSERT INTO refills (filled_at, meter, liters) VALUES ('2020-01-02T08:00', 1050, 2000);
  CREATE TABLE tank_levels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    read_at TEXT NOT NULL UNIQUE,
    level REAL NOT NULL CHECK (level >= 0),
    note TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE settings (key TEXT PRIMARY KEY, value REAL NOT NULL);
  INSERT INTO settings (key, value) VALUES ('tank_size', 3000);
`);
old.close();

process.env.DB_PATH = file;
const { db } = await import('./db.js');

after(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('migrates to one object with meters by former channel', () => {
  const object = db.prepare('SELECT id, name, tank_size FROM objects').all().map((o) => ({ ...o }));
  assert.deepEqual(object, [{ id: 1, name: 'Haus', tank_size: 3000 }]);
  const meters = db.prepare('SELECT object_id, kind, name, sub_of FROM meters ORDER BY id').all().map((m) => ({ ...m }));
  assert.deepEqual(meters.map((m) => [m.kind, m.name, m.sub_of === null]), [
    ['oil', 'Heizöl', true],
    ['water', 'Wasser', true],
    ['water', 'Gartenzähler', false],
  ]);
});

test('moves readings to their meters and keeps the values', () => {
  const rows = db
    .prepare(`SELECT m.name AS meter, r.read_at, r.meter AS value, r.tank_level
              FROM readings r JOIN meters m ON m.id = r.meter_id ORDER BY m.id, r.read_at`)
    .all()
    .map((r) => ({ ...r }));
  assert.deepEqual(rows, [
    { meter: 'Heizöl', read_at: '2020-01-01T08:00', value: 1000, tank_level: 500 },
    { meter: 'Heizöl', read_at: '2020-01-03T08:00', value: 1100, tank_level: null },
    { meter: 'Wasser', read_at: '2020-01-01T08:00', value: 50, tank_level: null },
    { meter: 'Gartenzähler', read_at: '2020-01-01T08:00', value: 20, tank_level: null },
  ]);
});

test('moves refills and gauge values to the object', () => {
  const refill = db.prepare('SELECT object_id, meter FROM refills').get();
  assert.deepEqual({ ...refill }, { object_id: 1, meter: 1050 });
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM tank_levels WHERE object_id = 1').get().n, 0);
});

test('channel-less or unknown meter kinds are rejected by the schema', () => {
  assert.throws(() =>
    db.prepare("INSERT INTO meters (object_id, kind, name) VALUES (1, 'coal', 'x')").run(),
  );
});
