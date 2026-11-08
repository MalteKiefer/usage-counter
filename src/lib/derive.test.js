import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIntervals, filterRange, monthlyTotals, summarize, weekdayAverages, windowStats } from './derive.js';

const readings = [
  { id: 1, read_at: '2026-01-01T08:00', meter: 1000 },
  { id: 2, read_at: '2026-01-03T08:00', meter: 1100 },
  { id: 3, read_at: '2026-02-02T08:00', meter: 1400 },
];

test('intervals hold liters, days and per-day rate', () => {
  const [a, b] = buildIntervals(readings);
  assert.equal(a.liters, 100);
  assert.equal(a.days, 2);
  assert.equal(a.perDay, 50);
  assert.equal(b.days, 30);
  assert.equal(b.cumulative, 400);
  assert.equal(b.month, '2026-02');
});

test('monthly totals attribute interval to end month', () => {
  assert.deepEqual(monthlyTotals(buildIntervals(readings)), [
    { month: '2026-01', liters: 100 },
    { month: '2026-02', liters: 300 },
  ]);
});

test('range filter keeps intervals ending inside the window', () => {
  const intervals = buildIntervals(readings);
  const now = new Date('2026-02-05T08:00');
  assert.equal(filterRange(intervals, 7, now).length, 1);
  assert.equal(filterRange(intervals, null, now).length, 2);
});

test('window stats sum intervals ending inside the window', () => {
  const intervals = buildIntervals(readings);
  const all = windowStats(intervals, null, new Date('2026-03-01T08:00'));
  assert.equal(all.liters, 400);
  assert.equal(all.perDay, 400 / 32);
  const recent = windowStats(intervals, 7, new Date('2026-02-05T08:00'));
  assert.equal(recent.liters, 300);
  assert.equal(recent.perDay, 10);
  assert.equal(windowStats(intervals, 7, new Date('2030-01-01T08:00')).perDay, null);
});

test('summary totals and averages', () => {
  const intervals = buildIntervals(readings);
  const s = summarize(readings, intervals);
  assert.equal(s.totalLiters, 400);
  assert.equal(s.spanDays, 32);
  assert.equal(s.lastPerDay, 10);
  assert.equal(summarize(readings.slice(0, 1), []), null);
});

test('elapsed days use wall-clock time across DST', () => {
  const [iv] = buildIntervals([
    { id: 1, read_at: '2026-03-29T02:30', meter: 100 },
    { id: 2, read_at: '2026-03-29T03:10', meter: 101 },
  ]);
  assert.equal(iv.days, 40 / 1440);
});

test('weekday without data has no average', () => {
  const intervals = buildIntervals([
    { id: 1, read_at: '2026-01-05T08:00', meter: 100 },
    { id: 2, read_at: '2026-01-06T08:00', meter: 130 },
  ]);
  const days = weekdayAverages(intervals);
  assert.equal(days[1].perDay, 30);
  assert.equal(days[5].perDay, null);
});
