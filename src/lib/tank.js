import { DAY_MS, elapsedDays, localWallMs, wallMs } from './derive.js';

// A refill without level_after leaves the tank full.
const startLevel = (refill, tankSize) => refill.level_after ?? tankSize;

// Meter value taken in exactly this minute, or null.
const meterAt = (readings, readAt) => readings.find((r) => r.read_at === readAt)?.meter ?? null;

// Meter value at a refill: typed in with the refill, else the reading taken in the same minute.
const refillMeter = (readings, refill) => refill.meter ?? meterAt(readings, refill.filled_at);

// Gauge observations: gauge readings and standalone entries. Entries without a same-minute reading keep meter null.
export function gaugePoints(readings, tankLevels = []) {
  const fromReadings = readings
    .filter((r) => r.tank_level != null)
    .map((r) => ({ t: r.read_at, level: r.tank_level, meter: r.meter }));
  const fromEntries = tankLevels.map((g) => ({ t: g.read_at, level: g.level, meter: meterAt(readings, g.read_at) }));
  return [...fromReadings, ...fromEntries].sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));
}

// Level and meter the estimate counts from: the latest gauge with a known meter, else the refill.
function anchorFor(gauges, readings, refill, tankSize, upTo) {
  const measured = gauges.findLast((g) => g.meter != null && g.t >= refill.filled_at && g.t <= upTo);
  if (measured) return { level: measured.level, meter: measured.meter };
  const meter = refillMeter(readings, refill);
  const start = startLevel(refill, tankSize);
  if (meter == null || start == null) return null;
  return { level: start, meter };
}

// Estimated level at the last observation, counted from the latest refill or gauge.
export function tankState(readings, refills, tankSize, tankLevels = []) {
  const refill = refills.at(-1);
  const last = readings.at(-1);
  if (!refill || !last) return null;
  const gauges = gaugePoints(readings, tankLevels);
  const newest = gauges.at(-1);
  if (newest && newest.t >= refill.filled_at && newest.t >= last.read_at) {
    return { level: newest.level, asOf: newest.t };
  }
  if (refill.filled_at > last.read_at) {
    const start = startLevel(refill, tankSize);
    return start == null ? null : { level: start, asOf: refill.filled_at };
  }
  const anchor = anchorFor(gauges, readings, refill, tankSize, last.read_at);
  if (!anchor) return null;
  return { level: Math.max(0, anchor.level - (last.meter - anchor.meter)), asOf: last.read_at };
}

// Level at every reading, gauge observation and refill, sorted by time.
export function levelHistory(readings, refills, tankSize, tankLevels = []) {
  const gauges = gaugePoints(readings, tankLevels);
  const points = refills.map((f) => ({ t: f.filled_at, level: startLevel(f, tankSize) }));
  points.push(...gauges.map((g) => ({ t: g.t, level: g.level })));
  for (const r of readings) {
    const refill = refills.findLast((f) => f.filled_at <= r.read_at);
    const anchor = refill ? anchorFor(gauges, readings, refill, tankSize, r.read_at) : null;
    const level = anchor ? Math.max(0, anchor.level - (r.meter - anchor.meter)) : null;
    points.push({ t: r.read_at, level });
  }
  return points.sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));
}

// Meter use and days since the latest refill, or null without a meter value at the refill.
export function usageSinceRefill(readings, refills) {
  const refill = refills.at(-1);
  const last = readings.at(-1);
  if (!refill || !last) return null;
  if (refill.filled_at > last.read_at) return { liters: 0, days: 0, perDay: null };
  const meter = refillMeter(readings, refill);
  if (meter == null) return null;
  const liters = last.meter - meter;
  const days = elapsedDays(refill.filled_at, last.read_at);
  return { liters, days, perDay: days > 0 ? liters / days : null };
}

// Days from `nowWall` until the tank runs empty at a constant daily rate.
export function forecast(state, perDay, nowWall = localWallMs()) {
  if (!state || !(perDay > 0)) return null;
  const runsOut = wallMs(state.asOf) + (state.level / perDay) * DAY_MS;
  return { runsOut, daysLeft: Math.max(0, (runsOut - nowWall) / DAY_MS) };
}
