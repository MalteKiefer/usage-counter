import { fmt, fmtMonth, fmtShortDate, weekdayLabel } from './format.js';
import { weekdayAverages } from './derive.js';

export const SERIES = { flame: '#ff8a3d', teal: '#4fd1c5', violet: '#a78bfa', sky: '#7dd3fc' };

const round = (value, digits) => Math.round(value * 10 ** digits) / 10 ** digits;
const dayLabel = (iv) => fmtShortDate(iv.end);

function cumulativeChart(intervals, unit, digits, t) {
  const base = intervals.length > 0 ? intervals[0].cumulative - intervals[0].liters : 0;
  return {
    id: 'cum',
    label: t('chart.cum.label'),
    title: t('chart.cum.title'),
    subtitle: t('chart.cum.sub'),
    kind: 'area',
    unit,
    digits,
    series: [{ key: 'total', name: t('chart.cum.name'), color: SERIES.flame }],
    data: intervals.map((iv) => ({ label: dayLabel(iv), total: round(iv.cumulative - base, digits) })),
  };
}

function monthChart(monthlyTotals, unit, digits, t) {
  return {
    id: 'month',
    label: t('chart.month.label'),
    title: t('chart.month.title'),
    subtitle: t('chart.month.sub'),
    kind: 'bar',
    unit,
    digits,
    series: [{ key: 'value', name: t('chart.month.name'), color: SERIES.violet }],
    data: monthlyTotals.map((m) => ({ label: fmtMonth(m.month), value: round(m.liters, digits) })),
  };
}

// Days without readings stay null, so the chart shows a gap instead of zero.
function weekdayChart(intervals, dayUnit, digits, t) {
  return {
    id: 'weekday',
    label: t('chart.week.label'),
    title: t('chart.week.title', { unit: dayUnit }),
    subtitle: t('chart.week.sub'),
    kind: 'bar',
    unit: dayUnit,
    digits,
    series: [{ key: 'rate', name: dayUnit, color: SERIES.sky }],
    data: weekdayAverages(intervals).map((w) => ({
      label: weekdayLabel(w.index),
      rate: w.perDay == null ? null : round(w.perDay, digits),
    })),
  };
}

// Standard charts for one consumption series.
export function meterCharts(intervals, monthlyTotals, { unit, dayUnit, digits }, t) {
  const totalLiters = intervals.reduce((s, iv) => s + iv.liters, 0);
  const totalDays = intervals.reduce((s, iv) => s + iv.days, 0);
  const avg = totalDays > 0 ? totalLiters / totalDays : 0;
  return [
    {
      id: 'bars',
      label: t('chart.bars.label'),
      title: t('chart.bars.title'),
      subtitle: t('chart.bars.sub', { unit }),
      kind: 'bar',
      unit,
      digits,
      series: [{ key: 'value', name: t('chart.usage'), color: SERIES.flame }],
      data: intervals.map((iv) => ({ label: dayLabel(iv), value: round(iv.liters, digits) })),
    },
    {
      id: 'rate',
      label: t('chart.rate.label'),
      title: t('chart.rate.title', { unit: dayUnit }),
      subtitle: t('chart.rate.sub', { avg: fmt(avg, digits), unit: dayUnit }),
      kind: 'area',
      unit: dayUnit,
      digits,
      series: [{ key: 'rate', name: dayUnit, color: SERIES.teal }],
      data: intervals.map((iv) => ({ label: dayLabel(iv), rate: round(iv.perDay, digits) })),
      ref: { y: round(avg, digits), label: 'Ø' },
    },
    cumulativeChart(intervals, unit, digits, t),
    monthChart(monthlyTotals, unit, digits, t),
    weekdayChart(intervals, dayUnit, digits, t),
  ];
}

export function tankChart(levels, t, unit) {
  return {
    id: 'tank',
    label: t('chart.tank.label'),
    title: t('chart.tank.title'),
    subtitle: t('chart.tank.sub'),
    kind: 'area',
    unit,
    digits: 1,
    connectNulls: true,
    series: [{ key: 'value', name: t('chart.tank.name'), color: SERIES.sky }],
    data: levels.map((p) => ({ label: fmtShortDate(new Date(p.t)), value: p.level == null ? null : round(p.level, 1) })),
  };
}

// House and garden share per interval, next to the main meter totals.
export function waterCharts(paired, monthlyTotals, { unit, digits }, t) {
  return [
    {
      id: 'split',
      label: t('chart.split.label'),
      title: t('chart.split.title'),
      subtitle: t('chart.split.sub'),
      kind: 'bar',
      unit,
      digits,
      stacked: true,
      series: [
        { key: 'house', name: t('chart.split.house'), color: SERIES.teal },
        { key: 'garden', name: t('chart.split.garden'), color: SERIES.violet },
      ],
      data: paired.map((iv) => ({
        label: dayLabel(iv),
        house: iv.house == null ? null : round(iv.house, digits),
        garden: iv.garden == null ? null : round(iv.garden, digits),
      })),
    },
    {
      id: 'rate',
      label: t('chart.rate.label'),
      title: t('chart.waterRate.title', { unit }),
      subtitle: t('chart.waterRate.sub'),
      kind: 'area',
      unit: `${unit}/${t('unit.day')}`,
      digits,
      series: [
        { key: 'house', name: t('chart.split.house'), color: SERIES.teal },
        { key: 'garden', name: t('chart.split.garden'), color: SERIES.violet },
      ],
      data: paired.map((iv) => ({
        label: dayLabel(iv),
        house: iv.house == null ? null : round(iv.house / iv.days, digits),
        garden: iv.garden == null ? null : round(iv.garden / iv.days, digits),
      })),
    },
    cumulativeChart(paired, unit, digits, t),
    monthChart(monthlyTotals, unit, digits, t),
    weekdayChart(paired, `${unit}/${t('unit.day')}`, digits, t),
  ];
}
