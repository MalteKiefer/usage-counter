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
import { tankUnitLabel } from '../lib/units.js';
import { convertTank, DEFAULT_LPG_DENSITY, isTankMeter } from '../lib/meters.js';
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

const gardenSub = (value, t, unit) =>
  value == null ? t('stat.noGardenShare') : t('stat.ofWhich', { v: `${fmt(value, 3)} ${unit}` });

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

// Tank values are shown in the unit of the tank: litres for oil, litres or kilograms for gas.
const anzeigerColumn = (tankUnit) => ({
  key: 'gauge',
  label: 'col.gauge',
  num: true,
  render: (r) => (r.tank_level != null ? `ca. ${fmt(r.tank_level)} ${tankUnit}` : 'n/a'),
});

const refillColumns = (tankUnit) => [
  { key: 'date', label: 'col.date', render: (r) => fmtDateTime(r.filled_at) },
  { key: 'meter', label: 'col.meter', num: true, render: (r) => (r.meter != null ? `${fmt(r.meter)} ${tankUnit}` : 'n/a') },
  { key: 'amount', label: 'col.amount', num: true, render: (r) => `${fmt(r.liters)} ${tankUnit}` },
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
    render: (r, t) => (r.level_after != null ? `${fmt(r.level_after)} ${tankUnit}` : t('ledger.full')),
  },
  { key: 'note', label: 'col.note', muted: true, render: (r) => r.note },
];

const gaugeColumns = (tankUnit) => [
  { key: 'date', label: 'col.date', render: (r) => fmtDateTime(r.read_at) },
  { key: 'level', label: 'col.level', num: true, render: (r) => `ca. ${fmt(r.level)} ${tankUnit}` },
  { key: 'note', label: 'col.note', muted: true, render: (r) => r.note },
];

// One meter of the selected object. Its readings, charts and forms; a tank belongs to its meter.
export default function MeterView({ meter, meters, readings, refills, tankLevels, range, actions }) {
  const t = useT();
  const units = useMemo(() => unitsFor(meter.kind, t), [meter.kind, t]);
  const { unit, dayUnit, digits } = units;
  const tank = isTankMeter(meter);
  const water = meter.kind === 'water';
  const tankSize = meter.tank_size;
  const tankUnit = tankUnitLabel(meter.tank_unit);
  // Gas tanks also show the size in the other unit, with the density the user gave (or the default).
  const tankEquivalent =
    meter.kind === 'gas' && tankSize != null
      ? {
          value: convertTank(tankSize, meter.tank_unit, meter.tank_density ?? DEFAULT_LPG_DENSITY),
          unit: tankUnitLabel(meter.tank_unit === 'kg' ? 'l' : 'kg'),
          density: meter.tank_density ?? DEFAULT_LPG_DENSITY,
        }
      : null;

  const mine = useMemo(() => readings.filter((r) => r.meter_id === meter.id), [readings, meter.id]);
  const tankRefills = useMemo(() => refills.filter((f) => f.meter_id === meter.id), [refills, meter.id]);
  const tankGauges = useMemo(() => tankLevels.filter((l) => l.meter_id === meter.id), [tankLevels, meter.id]);
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
          sub: garden ? gardenSub(shareSum(paired, days, 'garden'), t, unit) : undefined,
        };
      }),
    [paired, garden, t, unit],
  );

  const rate = useMemo(
    () => windowStats(intervals, RATE_DAYS).perDay ?? summary?.avgPerDay ?? null,
    [intervals, summary],
  );
  const state = useMemo(
    () => (tank ? tankState(mine, tankRefills, tankSize, tankGauges) : null),
    [tank, mine, tankRefills, tankSize, tankGauges],
  );
  const reach = useMemo(() => forecast(state, rate), [state, rate]);
  const levels = useMemo(
    () => (tank ? levelHistory(mine, tankRefills, tankSize, tankGauges) : []),
    [tank, mine, tankRefills, tankSize, tankGauges],
  );
  const since = useMemo(() => (tank ? usageSinceRefill(mine, tankRefills) : null), [tank, mine, tankRefills]);

  const last = mine.at(-1);
  const cards = water
    ? [
        {
          label: t('stat.mainMeter'),
          value: last ? withUnit(last.meter, unit, digits) : 'n/a',
          sub: last ? fmtDateTime(last.read_at) : t('stat.noReading'),
        },
        {
          label: t('stat.house'),
          value: withUnit(shareSum(paired, range.days, 'house'), unit, digits),
          sub: `${t(range.label)} · ${t('stat.shared')}`,
        },
        {
          label: t('stat.garden'),
          value: withUnit(shareSum(paired, range.days, 'garden'), unit, digits),
          sub: `${t(range.label)} · ${t('stat.shared')}`,
        },
        {
          label: t('stat.perDay'),
          value: withUnit(rangeStats.perDay, dayUnit, digits),
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
        tank
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
    if (tank) return [...meterCharts(visible, monthly, units, t), tankChart(levels, t, tankUnit)];
    if (water) return waterCharts(visible, monthly, units, t);
    return meterCharts(visible, monthly, units, t);
  }, [tank, water, visible, monthly, levels, units, t, tankUnit]);

  const meterForm = (
    <MeterForm
      meter={meter}
      garden={garden}
      readings={mine}
      unit={unit}
      gaugeUnit={tankUnit}
      onSave={actions.saveMeters}
    />
  );
  const entryTabs = tank
    ? [
        { id: 'reading', label: t('form.reading'), node: meterForm },
        {
          id: 'refill',
          label: t('form.refill'),
          node: <RefillForm unit={tankUnit} meterUnit={unit} onSave={(body) => actions.saveRefill(meter.id, body)} />,
        },
        {
          id: 'gauge',
          label: t('form.gauge'),
          node: <TankLevelForm unit={tankUnit} onSave={(body) => actions.saveTankLevel(meter.id, body)} />,
        },
      ]
    : [{ id: 'reading', label: t('form.reading'), node: meterForm }];

  const ledgerTabs = tank
    ? [
        {
          id: 'readings',
          label: t('ledger.readings'),
          endpoint: 'readings',
          rows: withIntervals(mine, intervals),
          columns: readingColumns(units, [anzeigerColumn(tankUnit)]),
        },
        { id: 'refills', label: t('ledger.refills'), endpoint: 'refills', rows: tankRefills, columns: refillColumns(tankUnit) },
        { id: 'gauge', label: t('ledger.gauge'), endpoint: 'tank-levels', rows: tankGauges, columns: gaugeColumns(tankUnit) },
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

      {tank ? (
        <div className="split">
          <EntryCard tabs={entryTabs} />
          <TankCard
            key={`${meter.id}-${tankSize}`}
            tankSize={tankSize}
            unit={tankUnit}
            equivalent={tankEquivalent}
            state={state}
            reach={reach}
            rate={rate}
            unitDay={dayUnit}
            lastRefill={tankRefills.at(-1)}
            sinceRefill={since}
            onSaveTank={(size) => actions.saveTankSize(meter.id, size)}
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
