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
  assert.match((await res.json()).error, /Datum ungültig/);
  assert.equal((await getJson(`/api/objects/${objectId}/readings`)).length, 2);
});
