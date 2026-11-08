import { useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { fmt } from '../lib/format.js';
import { useT } from '../i18n.js';

const COLORS = { grid: 'rgba(255,255,255,0.06)', text: '#8b93a7', violet: '#a78bfa' };
const axis = { stroke: COLORS.text, fontSize: 12, tickLine: false, axisLine: false };

export default function ChartTabs({ charts }) {
  const t = useT();
  const [active, setActive] = useState(charts[0].id);
  const chart = charts.find((c) => c.id === active) ?? charts[0];
  const hasData = chart.data.some((d) => chart.series.some((s) => d[s.key] != null));

  return (
    <section className="card">
      <div className="ledger-head">
        <div>
          <h2>{chart.title}</h2>
          <p className="muted small">{chart.subtitle}</p>
        </div>
        <div className="tabs" role="tablist">
          {charts.map((c) => (
            <button
              key={c.id}
              role="tab"
              aria-selected={chart.id === c.id}
              className={chart.id === c.id ? 'active' : ''}
              onClick={() => setActive(c.id)}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>
      {hasData ? (
        <ResponsiveContainer width="100%" height={340}>
          <ChartBody chart={chart} />
        </ResponsiveContainer>
      ) : (
        <div className="empty">{t('chart.empty')}</div>
      )}
    </section>
  );
}

function ChartBody({ chart }) {
  const tooltip = (
    <Tooltip
      contentStyle={{ background: '#141a2e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10 }}
      labelStyle={{ color: '#e6e9f2' }}
      cursor={{ fill: 'rgba(255,255,255,0.04)' }}
      formatter={(value, name) => [`${fmt(value, chart.digits)} ${chart.unit}`, name]}
    />
  );
  const grid = <CartesianGrid stroke={COLORS.grid} vertical={false} />;
  const axes = [<XAxis key="x" dataKey="label" {...axis} />, <YAxis key="y" {...axis} />];

  if (chart.kind === 'bar') {
    return (
      <BarChart data={chart.data}>
        {grid}
        {axes}
        {tooltip}
        {chart.series.map((s) => (
          <Bar
            key={s.key}
            dataKey={s.key}
            name={s.name}
            fill={s.color}
            stackId={chart.stacked ? 'stack' : undefined}
            radius={chart.stacked ? 0 : [6, 6, 0, 0]}
          />
        ))}
      </BarChart>
    );
  }

  return (
    <AreaChart data={chart.data}>
      <defs>
        {chart.series.map((s) => (
          <linearGradient key={s.key} id={`g-${chart.id}-${s.key}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={s.color} stopOpacity={0.45} />
            <stop offset="100%" stopColor={s.color} stopOpacity={0} />
          </linearGradient>
        ))}
      </defs>
      {grid}
      {axes}
      {tooltip}
      {chart.ref && (
        <ReferenceLine
          y={chart.ref.y}
          stroke={COLORS.violet}
          strokeDasharray="4 4"
          label={{ value: chart.ref.label, fill: COLORS.violet }}
        />
      )}
      {chart.series.map((s) => (
        <Area
          key={s.key}
          type="monotone"
          dataKey={s.key}
          name={s.name}
          stroke={s.color}
          strokeWidth={2}
          fill={`url(#g-${chart.id}-${s.key})`}
          connectNulls={!!chart.connectNulls}
        />
      ))}
    </AreaChart>
  );
}
