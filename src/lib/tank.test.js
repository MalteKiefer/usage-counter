import { test } from 'node:test';
import assert from 'node:assert/strict';
import { forecast, levelHistory, tankState, usageSinceRefill } from './tank.js';
import { wallMs } from './derive.js';

const readings = [
  { id: 1, read_at: '2020-01-01T08:00', meter: 1000 },
  { id: 2, read_at: '2020-01-10T08:00', meter: 1300 },
];
const refill = { id: 1, filled_at: '2020-01-05T08:00', meter: 1050, liters: 2500, level_after: null };

test('level is tank size minus meter use since the refill', () => {
  assert.deepEqual(tankState(readings, [refill], 3000), { level: 2750, asOf: '2020-01-10T08:00' });
});

test('refill after the last reading starts from its level', () => {
  const late = { ...refill, id: 2, filled_at: '2020-01-12T08:00', level_after: 2800 };
  assert.deepEqual(tankState(readings, [late], 3000), { level: 2800, asOf: '2020-01-12T08:00' });
});

test('no estimate without tank size or a meter value at the refill', () => {
  assert.equal(tankState(readings, [refill], null), null);
  assert.equal(tankState(readings, [{ ...refill, meter: undefined }], 3000), null);
});

test('same-minute reading serves as refill meter', () => {
  const sameMinute = [readings[0], { id: 3, read_at: '2020-01-05T08:00', meter: 1050 }, readings[1]];
  assert.equal(tankState(sameMinute, [{ ...refill, meter: undefined }], 3000).level, 2750);
});

test('gauge reading replaces the estimate as anchor', () => {
  const measured = [readings[0], { ...readings[1], tank_level: 2000 }];
  assert.equal(tankState(measured, [refill], 3000).level, 2000);
  const later = [...measured, { id: 3, read_at: '2020-01-12T08:00', meter: 1400, tank_level: null }];
  assert.equal(tankState(later, [refill], 3000).level, 1900);
});

test('standalone gauge without a same-minute reading does not anchor', () => {
  const tankLevels = [{ id: 1, read_at: '2020-01-07T08:00', level: 1500 }];
  assert.equal(tankState(readings, [refill], 3000, tankLevels).level, 2750);
});

test('standalone gauge with a same-minute reading anchors', () => {
  const tankLevels = [{ id: 1, read_at: '2020-01-10T08:00', level: 2000 }];
  assert.equal(tankState(readings, [refill], 3000, tankLevels).level, 2000);
});

test('usage since refill counts meter use and days', () => {
  assert.deepEqual(usageSinceRefill(readings, [refill]), { liters: 250, days: 5, perDay: 50 });
});

test('forecast divides level by daily rate from the reference time', () => {
  const state = { level: 2700, asOf: '2020-01-10T08:00' };
  assert.equal(forecast(state, 100, wallMs('2020-01-10T08:00')).daysLeft, 27);
  assert.equal(forecast(state, 0), null);
});

test('level history gives an estimate per reading and marks refills', () => {
  const points = levelHistory(readings, [refill], 3000);
  assert.deepEqual(points.map((p) => [p.t, p.level]), [
    ['2020-01-01T08:00', null],
    ['2020-01-05T08:00', 3000],
    ['2020-01-10T08:00', 2750],
  ]);
});
