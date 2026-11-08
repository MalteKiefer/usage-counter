import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-serial-'));
const file = path.join(dir, 'serial.db');

// Meters with a serial number but no tank columns: the state of builds between 2.1.1 and the tank move.
const old = new DatabaseSync(file);
old.exec(`
  PRAGMA foreign_keys = ON;
  CREATE TABLE objects (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL);
  CREATE TABLE meters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    object_id INTEGER NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('oil', 'water', 'power', 'gas')),
    name TEXT NOT NULL,
    sub_of INTEGER REFERENCES meters(id) ON DELETE CASCADE,
    serial TEXT,
    CHECK (sub_of IS NULL OR kind = 'water')
  );
  INSERT INTO objects (name) VALUES ('Haus');
  INSERT INTO meters (object_id, kind, name, serial) VALUES (1, 'power', 'Strom', 'S-42');
`);
old.close();

process.env.DB_PATH = file;
const { db } = await import('./db.js');

after(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('migration keeps serial numbers', () => {
  assert.equal(db.prepare("SELECT serial FROM meters WHERE kind = 'power'").get().serial, 'S-42');
  assert.equal(db.prepare("SELECT tank_unit FROM meters WHERE kind = 'power'").get().tank_unit, 'l');
});
