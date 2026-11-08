export const DAY_MS = 86_400_000;

// Local wall-clock time as ms. Real timestamps would shift across DST and can reverse order.
export function wallMs(readAt) {
  const [y, mo, d, h, mi] = readAt.split(/[-T:]/).map(Number);
  return Date.UTC(y, mo - 1, d, h, mi);
}

export const localWallMs = (date = new Date()) => date.getTime() - date.getTimezoneOffset() * 60_000;

export const elapsedDays = (from, to) => (wallMs(to) - wallMs(from)) / DAY_MS;

// Turns cumulative meter readings into consumption intervals between neighbours.
export function buildIntervals(readings) {
  const intervals = [];
  let cumulative = 0;
  for (let i = 1; i < readings.length; i++) {
    const from = readings[i - 1];
    const to = readings[i];
    const liters = to.meter - from.meter;
    const days = elapsedDays(from.read_at, to.read_at);
    cumulative += liters;
    intervals.push({
      id: to.id,
      from: from.read_at,
      to: to.read_at,
      end: new Date(to.read_at),
      days,
      liters,
      perDay: liters / days,
      cumulative,
      month: to.read_at.slice(0, 7),
    });
  }
  return intervals;
}

// Keeps intervals that end within the last `days` days. null means all.
export function filterRange(intervals, days, now = new Date()) {
  if (days === null) return intervals;
  const since = now.getTime() - days * DAY_MS;
  return intervals.filter((iv) => iv.end.getTime() >= since);
}

// Consumption over intervals that end inside the window.
export function windowStats(intervals, days, now = new Date()) {
  const inWindow = filterRange(intervals, days, now);
  const liters = inWindow.reduce((sum, iv) => sum + iv.liters, 0);
  const spanDays = inWindow.reduce((sum, iv) => sum + iv.days, 0);
  return { liters, spanDays, perDay: spanDays > 0 ? liters / spanDays : null };
}

export function monthlyTotals(intervals) {
  const byMonth = new Map();
  for (const iv of intervals) {
    byMonth.set(iv.month, (byMonth.get(iv.month) ?? 0) + iv.liters);
  }
  return [...byMonth].map(([month, liters]) => ({ month, liters }));
}

// Average rate per weekday (index 0 = Monday) of the reading that ends each interval.
export function weekdayAverages(intervals) {
  const sums = Array.from({ length: 7 }, () => ({ liters: 0, days: 0 }));
  for (const iv of intervals) {
    sums[iv.end.getDay()].liters += iv.liters;
    sums[iv.end.getDay()].days += iv.days;
  }
  return [1, 2, 3, 4, 5, 6, 0].map((d, index) => ({
    index,
    perDay: sums[d].days > 0 ? sums[d].liters / sums[d].days : null,
  }));
}

export function summarize(readings, intervals) {
  if (readings.length < 2) return null;
  const first = readings[0];
  const last = readings.at(-1);
  const totalLiters = last.meter - first.meter;
  const spanDays = elapsedDays(first.read_at, last.read_at);
  return {
    totalLiters,
    spanDays,
    avgPerDay: totalLiters / spanDays,
    lastPerDay: intervals.at(-1).perDay,
    lastMeter: last.meter,
    lastRead: last.read_at,
  };
}
