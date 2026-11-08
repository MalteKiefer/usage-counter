import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oil-backup-'));
process.env.DB_PATH = path.join(dir, 'test.db');
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
  assert.equal(backup.version, 2);
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
  const body = await res.json();
  assert.equal(body.error, 'backup.row');
  assert.equal(body.params.cause.code, 'backup.missingRef');
  assert.equal((await getJson(`/api/objects/${objectId}/readings`)).length, 2);
});

test('restore rejects an invalid row before writing', async () => {
  const oil = await (await send('POST', `/api/objects/${objectId}/meters`, { kind: 'oil', name: 'Heizöl', tank_size: 3000 })).json();
  const backup = await getJson('/api/backup');
  backup.data.refills.push({ id: 1, meter_id: oil.id, filled_at: '2020-02-30T10:00', meter: null, liters: 10, total_eur: null, level_after: null, note: '' });
  const res = await send('POST', '/api/restore?confirm=replace', backup);
  assert.equal(res.status, 422);
  const body = await res.json();
  assert.equal(body.error, 'backup.row');
  assert.equal(body.params.cause.code, 'date.invalid');
  assert.equal((await getJson(`/api/objects/${objectId}/readings`)).length, 2);
});

test('restore rejects entries that are not objects with a client error', async () => {
  const backup = await getJson('/api/backup');
  backup.data.objects.push(null);
  const res = await send('POST', '/api/restore?confirm=replace', backup);
  assert.equal(res.status, 422);
  assert.equal((await res.json()).error, 'backup.rowNotObject');
});

test('restore applies the same limits as the API', async () => {
  const oil = await (await send('POST', `/api/objects/${objectId}/meters`, { kind: 'oil', name: 'Tank', tank_size: 3000 })).json();
  const backup = await getJson('/api/backup');
  backup.data.meters.find((m) => m.id === oil.id).tank_size = 100;
  backup.data.refills.push({ id: 60, meter_id: oil.id, filled_at: '2020-02-05T08:00', meter: null, liters: 10, total_eur: null, level_after: 500, note: '' });
  const res = await send('POST', '/api/restore?confirm=replace', backup);
  assert.equal(res.status, 422);
  const body = await res.json();
  assert.equal(body.error, 'backup.row');
  assert.equal(body.params.cause.code, 'tankSize.belowLevel');
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
  backup.data.meters.push({ id: 77, object_id: objectId, kind: 'oil', name: 'Heizöl', sub_of: null, serial: null, tank_size: null });
  backup.data.readings.push({ id: 77, meter_id: 77, read_at: '2020-01-01T08:00', meter: 100, tank_level: null, note: '' });
  backup.data.readings.push({ id: 78, meter_id: 77, read_at: '2020-03-01T08:00', meter: 200, tank_level: null, note: '' });
  backup.data.refills.push({ id: 50, meter_id: 77, filled_at: '2020-02-01T08:00', meter: 999999, liters: 10, total_eur: null, level_after: null, note: '' });
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

test('restore refuses bodies above the 25 MB limit', async () => {
  const body = JSON.stringify({ format: 'usage-counter-backup', version: 1, padding: 'x'.repeat(26 * 1024 * 1024) });
  const res = await send('POST', '/api/restore?confirm=replace', undefined, body);
  assert.equal(res.status, 413);
});

test('backup keeps serial numbers and gas meters', async () => {
  const house = await (await send('POST', '/api/objects', { name: 'Gashaus' })).json();
  const gas = await (await send('POST', `/api/objects/${house.id}/meters`, { kind: 'gas', name: 'Gas', serial: 'G-1' })).json();
  const backup = await getJson('/api/backup');
  assert.equal(backup.data.meters.find((m) => m.id === gas.id).serial, 'G-1');
  const res = await send('POST', '/api/restore?confirm=replace', backup);
  assert.equal(res.status, 200);
  const restored = (await getJson(`/api/objects/${house.id}/meters`)).find((m) => m.id === gas.id);
  assert.equal(restored.kind, 'gas');
  assert.equal(restored.serial, 'G-1');
});

test('restore rejects a serial number that is not text', async () => {
  const backup = await getJson('/api/backup');
  backup.data.meters[0].serial = 42;
  const res = await send('POST', '/api/restore?confirm=replace', backup);
  assert.equal(res.status, 422);
});

test('restore converts a version 1 backup and moves the tank to the oil meter', async () => {
  const body = {
    format: 'usage-counter-backup',
    version: 1,
    data: {
      objects: [{ id: 700, name: 'Alt', tank_size: 2500 }],
      meters: [{ id: 700, object_id: 700, kind: 'oil', name: 'Heizöl', sub_of: null }],
      readings: [{ id: 1, meter_id: 700, read_at: '2020-01-01T08:00', meter: 100, tank_level: null, note: '' }],
      refills: [{ id: 1, object_id: 700, filled_at: '2020-01-02T08:00', meter: null, liters: 500, total_eur: null, level_after: null, note: '' }],
      tank_levels: [],
    },
  };
  const res = await send('POST', '/api/restore?confirm=replace', body);
  assert.equal(res.status, 200);
  const [oil] = (await getJson('/api/objects/700/meters'));
  assert.equal(oil.tank_size, 2500);
  const [refill] = await getJson('/api/objects/700/refills');
  assert.equal(refill.meter_id, oil.id);
});

test('restore rejects a version 1 backup whose object list is not a list', async () => {
  const before = (await getJson('/api/objects')).length;
  const body = {
    format: 'usage-counter-backup',
    version: 1,
    data: { objects: 'alle', meters: [], readings: [], refills: [], tank_levels: [] },
  };
  const res = await send('POST', '/api/restore?confirm=replace', body);
  assert.equal(res.status, 422);
  assert.equal((await getJson('/api/objects')).length, before);
});

test('backup keeps the gas tank density', async () => {
  const house = await (await send('POST', '/api/objects', { name: 'Dichte' })).json();
  const gas = await (await send('POST', `/api/objects/${house.id}/meters`, { kind: 'gas', name: 'Gas', tank_size: 4.5, tank_density: 0.52 })).json();
  const backup = await getJson('/api/backup');
  assert.equal(backup.data.meters.find((m) => m.id === gas.id).tank_density, 0.52);
  assert.equal((await send('POST', '/api/restore?confirm=replace', backup)).status, 200);
  const restored = (await getJson(`/api/objects/${house.id}/meters`)).find((m) => m.id === gas.id);
  assert.equal(restored.tank_density, 0.52);
});
