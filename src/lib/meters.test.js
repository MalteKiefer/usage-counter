import { test } from 'node:test';
import assert from 'node:assert/strict';
import { convertTank, DEFAULT_LPG_DENSITY } from './meters.js';

test('litres become kilograms with the density and back', () => {
  assert.equal(convertTank(10, 'l', 0.5), 5);
  assert.equal(convertTank(5, 'kg', 0.5), 10);
});

test('the default density is used when a gas tank has none', () => {
  assert.equal(convertTank(11, 'kg', DEFAULT_LPG_DENSITY), 11 / 0.54);
});
