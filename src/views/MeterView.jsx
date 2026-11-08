import { useMemo } from 'react';
import ChartTabs from '../components/ChartTabs.jsx';
import EntryCard from '../components/EntryCard.jsx';
import Ledger from '../components/Ledger.jsx';
import MeterForm from '../components/MeterForm.jsx';
import RefillForm from '../components/RefillForm.jsx';
import StatCards from '../components/StatCards.jsx';
import TankCard from '../components/TankCard.jsx';
import TankLevelForm from '../components/TankLevelForm.jsx';
import WindowCards from '../components/WindowCards.jsx';
import { meterCharts, tankChart, waterCharts } from '../lib/charts.js';
import { buildIntervals, filterRange, monthlyTotals, summarize, windowStats } from '../lib/derive.js';
import { fmt, fmtDateTime, fmtMoney, fmtWallDate } from '../lib/format.js';
import { forecast, levelHistory, tankState, usageSinceRefill } from '../lib/tank.js';
import { unitsFor } from '../lib/units.js';
import { pairWater } from '../lib/water.js';
import { useT } from '../i18n.js';

const WINDOWS = [30, 90, 120];
const RATE_DAYS = 90;

const withUnit = (value, unit, digits) => (value == null ? 'n/a' : `${fmt(value, digits)} ${unit}`);

// Garden and house shares exist only where both meters were read, so sum what is known.
function shareSum(paired, days, key) {
  const known = filterRange(paired, days).filter((p) => p[key] != null);
  return known.length ? known.reduce((s, p) => s + p[key], 0) : null;
}

const gardenSub = (value, t) =>
  value == null ? t('stat.noGardenShare') : t('stat.ofWhich', { v: `${fmt(value, 3)} m³` });

const withIntervals = (rows, intervals) => {
  const byId = new Map(intervals.map((iv) => [iv.id, iv]));
  return rows.map((r) => ({ ...r, iv: byId.get(r.id) ?? null }));
};

function readingColumns(units, extra = []) {
  const { unit, digits } = units;
  return [
    { key: 'date', label: 'col.date', render: (r) => fmtDateTime(r.read_at) },
    { key: 'meter', label: 'col.meter', num: true, render: (r) => `${fmt(r.meter, digits)} ${unit}` },
    ...extra,
    { key: 'usage', label: 'col.usage', num: true, render: (r) => (r.iv ? `${fmt(r.iv.liters, digits)} ${unit}` : 'n/a') },
    { key: 'days', label: 'col.days', num: true, render: (r) => (r.iv ? fmt(r.iv.days) : 'n/a') },
    { key: 'perDay', label: 'col.perDay', num: true, render: (r) => (r.iv ? fmt(r.iv.perDay, digits) : 'n/a') },
    { key: 'note', label: 'col.note', muted: true, render: (r) => r.note },
  ];
}

const anzeigerColumn = {
  key: 'gauge',
  label: 'col.gauge',
  num: true,
  render: (r) => (r.tank_level != null ? `ca. ${fmt(r.tank_level)} L` : 'n/a'),
};

const refillColumns = [
  { key: 'date', label: 'col.date', render: (r) => fmtDateTime(r.filled_at) },
  { key: 'meter', label: 'col.meter', num: true, render: (r) => (r.meter != null ? `${fmt(r.meter)} L` : 'n/a') },
  { key: 'amount', label: 'col.amount', num: true, render: (r) => `${fmt(r.liters)} L` },
  { key: 'price', label: 'col.price', num: true, render: (r) => (r.total_eur != null ? fmtMoney(r.total_eur) : 'n/a') },
  {
    key: 'ppl',
    label: 'col.pricePerLiter',
    num: true,
    render: (r) => (r.total_eur != null ? fmtMoney(r.total_eur / r.liters) : 'n/a'),
  },
  {
    key: 'levelAfter',
    label: 'col.levelAfter',
    num: true,
    render: (r, t) => (r.level_after != null ? `${fmt(r.level_after)} L` : t('ledger.full')),
  },
  { key: 'note', label: 'col.note', muted: true, render: (r) => r.note },
];

const gaugeColumns = [
  { key: 'date', label: 'col.date', render: (r) => fmtDateTime(r.read_at) },
  { key: 'level', label: 'col.level', num: true, render: (r) => `ca. ${fmt(r.level)} L` },
  { key: 'note', label: 'col.note', muted: true, render: (r) => r.note },
];

// One meter of the selected object. Its readings, charts and forms; the tank belongs to the object.
export default function MeterView({ meter, meters, readings, refills, tankLevels, object, range, actions }) {
  const t = useT();
  const units = useMemo(() => unitsFor(meter.kind, t), [meter.kind, t]);
  const { unit, dayUnit, digits } = units;
  const oil = meter.kind === 'oil';
  const water = meter.kind === 'water';
  const tankSize = object.tank_size;

  const mine = useMemo(() => readings.filter((r) => r.meter_id === meter.id), [readings, meter.id]);
  const garden = useMemo(
    () => (water ? meters.find((m) => m.sub_of === meter.id) ?? null : null),
    [meters, meter.id, water],
  );
  const gardenReadings = useMemo(
    () => (garden ? readings.filter((r) => r.meter_id === garden.id) : []),
    [readings, garden],
  );
  const intervals = useMemo(() => buildIntervals(mine), [mine]);
  const gardenIntervals = useMemo(() => buildIntervals(gardenReadings), [gardenReadings]);
  const paired = useMemo(
    () => (garden ? pairWater(intervals, gardenReadings) : intervals),
    [garden, intervals, gardenReadings],
  );
  const visible = useMemo(() => filterRange(paired, range.days), [paired, range]);
  const monthly = useMemo(() => monthlyTotals(visible), [visible]);
  const summary = useMemo(() => summarize(mine, intervals), [mine, intervals]);
  const rangeStats = useMemo(() => windowStats(paired, range.days), [paired, range]);

  const windows = useMemo(
    () =>
      WINDOWS.map((days) => {
        const s = windowStats(paired, days);
        return {
          days,
          value: s.spanDays > 0 ? s.liters : null,
          perDay: s.perDay,
          sub: garden ? gardenSub(shareSum(paired, days, 'garden'), t) : undefined,
        };
      }),
    [paired, garden, t],
  );

  const rate = useMemo(
    () => windowStats(intervals, RATE_DAYS).perDay ?? summary?.avgPerDay ?? null,
    [intervals, summary],
  );
  const state = useMemo(
    () => (oil ? tankState(mine, refills, tankSize, tankLevels) : null),
    [oil, mine, refills, tankSize, tankLevels],
  );
  const reach = useMemo(() => forecast(state, rate), [state, rate]);
  const levels = useMemo(
    () => (oil ? levelHistory(mine, refills, tankSize, tankLevels) : []),
    [oil, mine, refills, tankSize, tankLevels],
  );
  const since = useMemo(() => (oil ? usageSinceRefill(mine, refills) : null), [oil, mine, refills]);

  const last = mine.at(-1);
  const cards = water
    ? [
        {
          label: t('stat.mainMeter'),
          value: last ? withUnit(last.meter, 'm³', 3) : 'n/a',
          sub: last ? fmtDateTime(last.read_at) : t('stat.noReading'),
        },
        {
          label: t('stat.house'),
          value: withUnit(shareSum(paired, range.days, 'house'), 'm³', 3),
          sub: `${t(range.label)} · ${t('stat.shared')}`,
        },
        {
          label: t('stat.garden'),
          value: withUnit(shareSum(paired, range.days, 'garden'), 'm³', 3),
          sub: `${t(range.label)} · ${t('stat.shared')}`,
        },
        {
          label: t('stat.perDay'),
          value: withUnit(rangeStats.perDay, `m³/${t('unit.day')}`, 3),
          sub: `${t(range.label)} · ${t('stat.days', { n: fmt(rangeStats.spanDays) })}`,
        },
      ]
    : [
        {
          label: t('stat.meter'),
          value: last ? withUnit(last.meter, unit, digits) : 'n/a',
          sub: last ? fmtDateTime(last.read_at) : t('stat.noReading'),
        },
        {
          label: t('stat.usage'),
          value: withUnit(rangeStats.spanDays > 0 ? rangeStats.liters : null, unit, digits),
          sub: `${t(range.label)} · ${t('stat.days', { n: fmt(rangeStats.spanDays) })}`,
        },
        {
          label: t('stat.perDay'),
          value: withUnit(rangeStats.perDay, dayUnit, digits),
          sub: summary
            ? t('stat.lastPeriodVal', { v: withUnit(summary.lastPerDay, dayUnit, digits) })
            : t('stat.needTwo'),
        },
        oil
          ? {
              label: t('stat.reach'),
              value: reach ? t('stat.days', { n: fmt(Math.round(reach.daysLeft)) }) : 'n/a',
              sub: reach
                ? t('stat.reachUntil', { date: fmtWallDate(reach.runsOut) })
                : tankSize
                  ? t('stat.reachNoLevel')
                  : t('stat.reachNoSize'),
            }
          : {
              label: t('stat.lastPeriod'),
              value: withUnit(summary?.lastPerDay, dayUnit, digits),
              sub: summary ? fmtDateTime(summary.lastRead) : t('stat.noDataYet'),
            },
      ];

  const charts = useMemo(() => {
    if (oil) return [...meterCharts(visible, monthly, units, t), tankChart(levels, t)];
    if (water) return waterCharts(visible, monthly, units, t);
    return meterCharts(visible, monthly, units, t);
  }, [oil, water, visible, monthly, levels, units, t]);

  const meterForm = (
    <MeterForm meter={meter} garden={garden} readings={mine} unit={unit} onSave={actions.saveMeters} />
  );
  const entryTabs = oil
    ? [
        { id: 'reading', label: t('form.reading'), node: meterForm },
        { id: 'refill', label: t('form.refill'), node: <RefillForm onSave={actions.saveRefill} /> },
        { id: 'gauge', label: t('form.gauge'), node: <TankLevelForm onSave={actions.saveTankLevel} /> },
      ]
    : [{ id: 'reading', label: t('form.reading'), node: meterForm }];

  const ledgerTabs = oil
    ? [
        {
          id: 'readings',
          label: t('ledger.readings'),
          endpoint: 'readings',
          rows: withIntervals(mine, intervals),
          columns: readingColumns(units, [anzeigerColumn]),
        },
        { id: 'refills', label: t('ledger.refills'), endpoint: 'refills', rows: refills, columns: refillColumns },
        { id: 'gauge', label: t('ledger.gauge'), endpoint: 'tank-levels', rows: tankLevels, columns: gaugeColumns },
      ]
    : water && garden
      ? [
          {
            id: 'readings',
            label: t('ledger.main'),
            endpoint: 'readings',
            rows: withIntervals(mine, intervals),
            columns: readingColumns(units),
          },
          {
            id: 'garden',
            label: t('ledger.garden'),
            endpoint: 'readings',
            rows: withIntervals(gardenReadings, gardenIntervals),
            columns: readingColumns(units),
          },
        ]
      : [
          {
            id: 'readings',
            label: t('ledger.readings'),
            endpoint: 'readings',
            rows: withIntervals(mine, intervals),
            columns: readingColumns(units),
          },
        ];

  return (
    <div className="view">
      <StatCards cards={cards} />
      <WindowCards windows={windows} unit={unit} dayUnit={dayUnit} digits={digits} />

      {oil ? (
        <div className="split">
          <EntryCard tabs={entryTabs} />
          <TankCard
            key={`${object.id}-${tankSize}`}
            tankSize={tankSize}
            state={state}
            reach={reach}
            rate={rate}
            unitDay={dayUnit}
            lastRefill={refills.at(-1)}
            sinceRefill={since}
            onSaveTank={actions.saveTankSize}
          />
        </div>
      ) : (
        <EntryCard tabs={entryTabs} />
      )}

      <ChartTabs charts={charts} />
      <Ledger tabs={ledgerTabs} onDelete={actions.remove} />
    </div>
  );
}
