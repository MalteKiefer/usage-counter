import { fmt } from '../lib/format.js';
import { useT } from '../i18n.js';

export default function WindowCards({ windows, unit, dayUnit, digits }) {
  const t = useT();
  const max = Math.max(0, ...windows.map((w) => w.value ?? 0));
  return (
    <section className="card windows">
      <h2>{t('window.title')}</h2>
      <div className="window-grid">
        {windows.map((w) => {
          const known = w.value != null;
          return (
            <div key={w.days} className="window">
              <span className="stat-label">{t('window.last', { n: w.days })}</span>
              <span className="window-value">{known ? `${fmt(w.value, digits)} ${unit}` : 'n/a'}</span>
              <span className="stat-sub">
                {known && w.perDay != null ? `${fmt(w.perDay, digits)} ${dayUnit}` : t('stat.noData')}
              </span>
              {w.sub && <span className="stat-sub">{w.sub}</span>}
              <div className="bar">
                <span style={{ width: known && max > 0 ? `${(w.value / max) * 100}%` : '0%' }} />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
