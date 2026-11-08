import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIntervals } from './derive.js';
import { pairWater } from './water.js';

test('garden share needs both meters read at the same times', () => {
  const main = buildIntervals([
    { id: 1, read_at: '2026-05-01T08:00', meter: 100 },
    { id: 2, read_at: '2026-05-11T08:00', meter: 110 },
    { id: 3, read_at: '2026-05-21T08:00', meter: 125 },
  ]);
  const garden = [
    { read_at: '2026-05-01T08:00', meter: 20 },
    { read_at: '2026-05-11T08:00', meter: 26 },
    { read_at: '2026-05-21T08:00', meter: 30 },
  ];
  const [a, b] = pairWater(main, garden);
  assert.equal(a.garden, 6);
  assert.equal(a.house, 4);
  assert.equal(b.garden, 4);
  assert.equal(b.house, 11);
  assert.equal(pairWater(main, garden.slice(0, 2))[1].garden, null);
});
