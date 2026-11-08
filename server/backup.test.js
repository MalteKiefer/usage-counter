import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oil-backup-'));
process.env.OIL_DB = path.join(dir, 'test.db');
const { app } = await import('./app.js');

let server;
let base;

before(() => new Promise((resolve) => {
  server = app.listen(0, '127.0.0.1', () => {
    base = `http://127.0.0.1:${server.address().port}`;
    resolve();
  });
}));

after(() => new Promise((resolve) => {
  server.close(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    resolve();
  });
}));

const send = (method, url, body, raw) =>
  fetch(`${base}${url}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
  });

const getJson = async (url) => (await fetch(`${base}${url}`)).json();

let objectId;
let waterId;
let gardenId;

test('exports the whole database with format and version', async () => {
  const object = await (await send('POST', '/api/objects', { name: 'Haus', tank_size: 750 })).json();
  objectId = object.id;
  waterId = (await (await send('POST', `/api/objects/${objectId}/meters`, { kind: 'water', name: 'Wasser' })).json()).id;
  gardenId = (await (await send('POST', `/api/objects/${objectId}/meters`, { kind: 'water', name: 'Garten', sub_of: waterId })).json()).id;
  await send('POST', '/api/readings', [
    { meter_id: waterId, read_at: '2020-01-01T08:00', meter: 50 },
    { meter_id: gardenId, read_at: '2020-01-01T08:00', meter: 20 },
  ]);
  const res = await fetch(`${base}/api/backup`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-disposition'), /^attachment; filename="usage-counter-backup-\d{4}-\d{2}-\d{2}\.json"$/);
  const backup = await res.json();
  assert.equal(backup.format, 'usage-counter-backup');
  assert.equal(backup.version, 1);
  assert.equal(backup.data.objects.length, 1);
  assert.equal(backup.data.meters.length, 2);
  assert.equal(backup.data.readings.length, 2);
});

test('restore without confirmation changes nothing', async () => {
  const backup = await getJson('/api/backup');
  const res = await send('POST', '/api/restore', backup);
  assert.equal(res.status, 422);
});

test('restore replaces data with the backup', async () => {
  const backup = await getJson('/api/backup');
  await send('POST', '/api/readings', { meter_id: waterId, read_at: '2020-02-01T08:00', meter: 60 });
  assert.equal((await getJson(`/api/objects/${objectId}/readings`)).length, 3);

  const res = await send('POST', '/api/restore?confirm=replace', backup);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { objects: 1, meters: 2, readings: 2, refills: 0, tankLevels: 0 });

  const readings = await getJson(`/api/objects/${objectId}/readings`);
  assert.deepEqual(readings.map((r) => r.read_at), ['2020-01-01T08:00', '2020-01-01T08:00']);
  const meters = await getJson(`/api/objects/${objectId}/meters`);
  assert.equal(meters.find((m) => m.name === 'Garten').sub_of, waterId);
});

test('restore rejects a wrong format and keeps the data', async () => {
  const before = await getJson('/api/backup');
  assert.equal((await send('POST', '/api/restore?confirm=replace', { format: 'other', version: 1, data: {} })).status, 422);
  assert.equal((await send('POST', '/api/restore?confirm=replace', { format: 'usage-counter-backup', version: 9, data: {} })).status, 422);
  const after = await getJson('/api/backup');
  assert.deepEqual(after.data, before.data);
});

test('restore rejects a dangling reference and keeps the data', async () => {
  const backup = await getJson('/api/backup');
  backup.data.readings.push({ id: 999, meter_id: 12345, read_at: '2020-03-01T08:00', meter: 1, tank_level: null, note: '' });
  const res = await send('POST', '/api/restore?confirm=replace', backup);
  assert.equal(res.status, 422);
  assert.match((await res.json()).error, /Zähler 12345 fehlt/);
  assert.equal((await getJson(`/api/objects/${objectId}/readings`)).length, 2);
});

test('restore rejects an invalid row before writing', async () => {
  const backup = await getJson('/api/backup');
  backup.data.refills.push({ id: 1, object_id: objectId, filled_at: '2020-02-30T10:00', meter: null, liters: 10, total_eur: null, level_after: null, note: '' });
  const res = await send('POST', '/api/restore?confirm=replace', backup);
  assert.equal(res.status, 422);
  assert.match((await res.json()).error, /Datum und Uhrzeit ungültig/);
  assert.equal((await getJson(`/api/objects/${objectId}/readings`)).length, 2);
});

test('restore rejects entries that are not objects with a client error', async () => {
  const backup = await getJson('/api/backup');
  backup.data.objects.push(null);
  const res = await send('POST', '/api/restore?confirm=replace', backup);
  assert.equal(res.status, 422);
  assert.match((await res.json()).error, /ist kein Objekt/);
});

test('restore applies the same limits as the API', async () => {
  const backup = await getJson('/api/backup');
  backup.data.objects[0].tank_size = 100;
  backup.data.refills.push({ id: 60, object_id: objectId, filled_at: '2020-02-05T08:00', meter: null, liters: 10, total_eur: null, level_after: 500, note: '' });
  const res = await send('POST', '/api/restore?confirm=replace', backup);
  assert.equal(res.status, 422);
  assert.match((await res.json()).error, /Füllstand|Tankgröße/);
});

test('restore rejects a meter value that decreases over time', async () => {
  const backup = await getJson('/api/backup');
  const water = backup.data.meters.find((m) => m.kind === 'water' && m.sub_of == null);
  backup.data.readings.push({ id: 900, meter_id: water.id, read_at: '2020-03-01T08:00', meter: 1, tank_level: null, note: '' });
  backup.data.readings.push({ id: 901, meter_id: water.id, read_at: '2020-04-01T08:00', meter: 0, tank_level: null, note: '' });
  const res = await send('POST', '/api/restore?confirm=replace', backup);
  assert.equal(res.status, 422);
});

test('restore rejects a refill meter value outside the oil readings around it', async () => {
  const backup = await getJson('/api/backup');
  backup.data.meters.push({ id: 77, object_id: objectId, kind: 'oil', name: 'Heizöl', sub_of: null });
  backup.data.readings.push({ id: 77, meter_id: 77, read_at: '2020-01-01T08:00', meter: 100, tank_level: null, note: '' });
  backup.data.readings.push({ id: 78, meter_id: 77, read_at: '2020-03-01T08:00', meter: 200, tank_level: null, note: '' });
  backup.data.refills.push({ id: 50, object_id: objectId, filled_at: '2020-02-01T08:00', meter: 999999, liters: 10, total_eur: null, level_after: null, note: '' });
  const res = await send('POST', '/api/restore?confirm=replace', backup);
  assert.equal(res.status, 422);
});

function timeOrderBackup(refillMeter) {
  return {
    format: 'usage-counter-backup',
    version: 1,
    data: {
      objects: [{ id: 500, name: 'Zeit', tank_size: null }],
      meters: [{ id: 500, object_id: 500, kind: 'oil', name: 'Heizöl', sub_of: null }],
      readings: [
        { id: 1, meter_id: 500, read_at: '2020-01-01T08:00', meter: 100, tank_level: null, note: '' },
        { id: 2, meter_id: 500, read_at: '2020-02-01T08:00', meter: 200, tank_level: null, note: '' },
        { id: 3, meter_id: 500, read_at: '2020-01-15T08:00', meter: 150, tank_level: null, note: '' },
      ],
      refills: [
        { id: 1, object_id: 500, filled_at: '2020-02-15T08:00', meter: refillMeter, liters: 10, total_eur: null, level_after: null, note: '' },
      ],
      tank_levels: [],
    },
  };
}

test('restore checks refill meters against readings in time order, not id order', async () => {
  const below = await send('POST', '/api/restore?confirm=replace', timeOrderBackup(180));
  assert.equal(below.status, 422);
  const above = await send('POST', '/api/restore?confirm=replace', timeOrderBackup(210));
  assert.equal(above.status, 200);
});
