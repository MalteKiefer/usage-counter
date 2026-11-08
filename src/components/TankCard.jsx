import { useState } from 'react';
import { fmt, fmtDateTime, fmtMoney, fmtWallDate, parseNumber } from '../lib/format.js';
import { errorText } from '../api.js';
import { useT } from '../i18n.js';

export default function TankCard({ tankSize, unit, equivalent, state, reach, rate, unitDay, lastRefill, sinceRefill, onSaveTank }) {
  const t = useT();
  const [size, setSize] = useState(tankSize ?? '');
  const [error, setError] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setError(null);
    try {
      const value = parseNumber(size);
      if (Number.isNaN(value)) throw new Error(t('form.invalidNumber'));
      await onSaveTank(value);
    } catch (err) {
      setError(errorText(err, t));
    }
  }

  const pct = state && tankSize ? Math.min(100, Math.max(0, (state.level / tankSize) * 100)) : null;

  return (
    <section className="card tank">
      <h2>{t('tank.title')}</h2>

      <form className="tank-size" onSubmit={submit}>
        <label>
          {t('tank.size')} ({unit})
          <div className="inline">
            <input
              type="text"
              placeholder={t('form.example', { v: fmt(3000, 0) })}
              value={size}
              onChange={(e) => setSize(e.target.value)}
              required
            />
            <button type="submit" className="ghost">{t('object.save')}</button>
          </div>
        </label>
      </form>
      {equivalent && (
        <p className="muted small">
          {t('tank.equivalent', { value: fmt(equivalent.value), unit: equivalent.unit, density: fmt(equivalent.density, 2) })}
        </p>
      )}
      {error && <div className="banner error">{error}</div>}

      {state ? (
        <div className="tank-level">
          <div className="gauge-head">
            <span className="stat-value">{fmt(state.level)} {unit}</span>
            {tankSize && (
              <span className="muted">{t('tank.of', { size: fmt(tankSize), unit, pct: fmt(pct) })}</span>
            )}
          </div>
          {pct !== null && (
            <div className="gauge" role="meter" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
              <div className="gauge-fill" style={{ width: `${pct}%` }} />
            </div>
          )}
          <p className="muted small">{t('tank.approx', { date: fmtDateTime(state.asOf) })}</p>
        </div>
      ) : (
        <p className="muted small">{t('tank.needs')}</p>
      )}

      {reach && (
        <div className="reach">
          {t('tank.reach', {
            date: fmtWallDate(reach.runsOut),
            days: fmt(Math.round(reach.daysLeft)),
            rate: `${fmt(rate)} ${unitDay}`,
          })}
        </div>
      )}

      {sinceRefill && sinceRefill.days > 0 && (
        <div className="last-refill">
          <span className="muted small">{t('tank.since')}</span>
          <span>
            <strong>{fmt(sinceRefill.liters)} {unit}</strong> · {fmt(sinceRefill.days)} {t('unit.day')} · {fmt(sinceRefill.perDay)} {unitDay}
          </span>
        </div>
      )}

      {lastRefill && (
        <div className="last-refill">
          <span className="muted small">{t('tank.last')}</span>
          <span>
            {fmtDateTime(lastRefill.filled_at)} · {fmt(lastRefill.liters)} {unit}
            {lastRefill.total_eur != null && ` · ${fmtMoney(lastRefill.total_eur)}`}
          </span>
        </div>
      )}
    </section>
  );
}
