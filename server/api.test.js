import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oil-test-'));
process.env.OIL_DB = path.join(dir, 'test.db');
const { app } = await import('./app.js');

let server;
let base;
let objectId;
const meters = {};

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

test('creates an object and rejects an empty name', async () => {
  assert.equal((await send('POST', '/api/objects', { name: '  ' })).status, 422);
  const res = await send('POST', '/api/objects', { name: 'Haus', tank_size: 750 });
  assert.equal(res.status, 201);
  objectId = (await res.json()).id;
});

test('creates meters, garden meter only behind a water meter', async () => {
  const oil = await send('POST', `/api/objects/${objectId}/meters`, { kind: 'oil', name: 'Heizöl' });
  meters.oil = (await oil.json()).id;
  const water = await send('POST', `/api/objects/${objectId}/meters`, { kind: 'water', name: 'Wasser' });
  meters.water = (await water.json()).id;
  const garden = await send('POST', `/api/objects/${objectId}/meters`, {
    kind: 'water',
    name: 'Garten',
    sub_of: meters.water,
  });
  assert.equal(garden.status, 201);
  meters.garden = (await garden.json()).id;
  const power = await send('POST', `/api/objects/${objectId}/meters`, { kind: 'power', name: 'Strom' });
  meters.power = (await power.json()).id;
  assert.equal(
    (await send('POST', `/api/objects/${objectId}/meters`, { kind: 'power', name: 'X', sub_of: meters.water })).status,
    422,
  );
  assert.equal((await getJson(`/api/objects/${objectId}/meters`)).length, 4);
});

test('stores several meters of one moment in one request or none', async () => {
  const ok = await send('POST', '/api/readings', [
    { meter_id: meters.water, read_at: '2020-01-01T08:00', meter: 50 },
    { meter_id: meters.garden, read_at: '2020-01-01T08:00', meter: 20 },
    { meter_id: meters.oil, read_at: '2020-01-01T08:00', meter: 1000 },
  ]);
  assert.equal(ok.status, 201);
  assert.equal((await ok.json()).length, 3);
  const bad = await send('POST', '/api/readings', [
    { meter_id: meters.water, read_at: '2020-01-02T08:00', meter: 51 },
    { meter_id: meters.garden, read_at: '2020-01-02T08:00', meter: 5 },
  ]);
  assert.equal(bad.status, 422);
  assert.match((await bad.json()).error, /^Eintrag 2: /);
  const water = (await getJson(`/api/objects/${objectId}/readings`)).filter((r) => r.meter_id === meters.water);
  assert.deepEqual(water.map((r) => r.read_at), ['2020-01-01T08:00']);
});

test('rejects two entries for the same meter in one request', async () => {
  const res = await send('POST', '/api/readings', [
    { meter_id: meters.water, read_at: '2020-03-01T08:00', meter: 70 },
    { meter_id: meters.water, read_at: '2020-03-02T08:00', meter: 71 },
  ]);
  assert.equal(res.status, 422);
});

test('rejects unknown meter and gauge value on a non-oil meter', async () => {
  assert.equal((await send('POST', '/api/readings', { meter_id: 9999, read_at: '2020-01-02T08:00', meter: 1 })).status, 422);
  assert.equal(
    (await send('POST', '/api/readings', {
      meter_id: meters.water,
      read_at: '2020-01-02T08:00',
      meter: 51,
      tank_level: 300,
    })).status,
    422,
  );
});

test('rejects a meter value below the previous reading of the same meter', async () => {
  assert.equal(
    (await send('POST', '/api/readings', { meter_id: meters.oil, read_at: '2020-01-02T08:00', meter: 990 })).status,
    422,
  );
  assert.equal(
    (await send('POST', '/api/readings', { meter_id: meters.oil, read_at: '2020-01-02T08:00', meter: 1050, tank_level: 300 })).status,
    201,
  );
});

test('duplicate timestamp of one meter gives 409', async () => {
  assert.equal(
    (await send('POST', '/api/readings', { meter_id: meters.oil, read_at: '2020-01-01T08:00', meter: 1000 })).status,
    409,
  );
});

test('rejects impossible date and future reading', async () => {
  assert.equal(
    (await send('POST', '/api/readings', { meter_id: meters.power, read_at: '2020-02-30T10:00', meter: 1 })).status,
    422,
  );
  assert.equal(
    (await send('POST', '/api/readings', { meter_id: meters.power, read_at: '2999-01-01T08:00', meter: 1 })).status,
    422,
  );
});

test('malformed JSON is a client error', async () => {
  assert.equal((await send('POST', '/api/readings', undefined, '{bad')).status, 400);
});

test('unknown API path returns JSON 404', async () => {
  const res = await fetch(`${base}/api/nope`);
  assert.equal(res.status, 404);
  assert.equal(res.headers.get('content-type').startsWith('application/json'), true);
});

test('tank size of an object is validated', async () => {
  assert.equal((await send('PUT', `/api/objects/${objectId}`, { tank_size: 0 })).status, 422);
  const res = await send('PUT', `/api/objects/${objectId}`, { tank_size: 3000 });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).tank_size, 3000);
});

test('stores standalone tank level and rejects above tank size', async () => {
  const ok = await send('POST', `/api/objects/${objectId}/tank-levels`, { read_at: '2020-01-02T08:00', level: 400 });
  assert.equal(ok.status, 201);
  assert.equal(
    (await send('POST', `/api/objects/${objectId}/tank-levels`, { read_at: '2020-01-03T08:00', level: 4000 })).status,
    422,
  );
  const [row] = await getJson(`/api/objects/${objectId}/tank-levels`);
  assert.equal((await send('DELETE', `/api/tank-levels/${row.id}`)).status, 204);
});

test('refill meter must fit the oil readings of the object', async () => {
  const low = await send('POST', `/api/objects/${objectId}/refills`, {
    filled_at: '2020-01-04T08:00',
    meter: 1040,
    liters: 100,
  });
  assert.equal(low.status, 422);
  const ok = await send('POST', `/api/objects/${objectId}/refills`, {
    filled_at: '2020-01-04T08:00',
    meter: 1150,
    liters: 100,
  });
  assert.equal(ok.status, 201);
  const body = await ok.json();
  assert.equal(body.meter, 1150);
  assert.equal((await send('DELETE', `/api/refills/${body.id}`)).status, 204);
});

test('rejects refill with zero liters or level above tank size', async () => {
  assert.equal((await send('POST', `/api/objects/${objectId}/refills`, { filled_at: '2020-01-06T08:00', liters: 0 })).status, 422);
  assert.equal(
    (await send('POST', `/api/objects/${objectId}/refills`, { filled_at: '2020-01-06T08:00', liters: 100, level_after: 3500 })).status,
    422,
  );
});

test('tank size of an object cannot drop below stored levels', async () => {
  // oil reading 2020-01-02 holds a gauge value of 300 L
  assert.equal((await send('PUT', `/api/objects/${objectId}`, { tank_size: 250 })).status, 422);
  assert.equal((await send('PUT', `/api/objects/${objectId}`, { tank_size: 3000 })).status, 200);
});

test('deleting a meter removes its readings', async () => {
  await send('POST', '/api/readings', { meter_id: meters.power, read_at: '2020-01-01T08:00', meter: 5 });
  assert.equal((await send('DELETE', `/api/meters/${meters.power}`)).status, 204);
  const left = await getJson(`/api/objects/${objectId}/readings`);
  assert.equal(left.some((r) => r.meter_id === meters.power), false);
});

test('answers only to local host names', async () => {
  const status = await new Promise((resolve, reject) => {
    const req = http.get(`${base}/api/objects`, { headers: { Host: 'evil.test' } }, (res) => {
      res.resume();
      resolve(res.statusCode);
    });
    req.on('error', reject);
  });
  assert.equal(status, 403);
});

test('sends security headers', async () => {
  const res = await fetch(`${base}/api/objects`);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.match(res.headers.get('content-security-policy'), /default-src 'self'/);
});

test('deleting an object removes its meters', async () => {
  assert.equal((await send('DELETE', `/api/objects/${objectId}`)).status, 204);
  assert.equal((await send('GET', `/api/objects/${objectId}/meters`)).status, 404);
});
