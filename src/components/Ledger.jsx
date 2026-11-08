import { useState } from 'react';
import { useT } from '../i18n.js';

// Each tab: rows (oldest first), columns with render(row), endpoint for deletes.
export default function Ledger({ tabs, onDelete }) {
  const t = useT();
  const [active, setActive] = useState(tabs[0].id);
  const tab = tabs.find((x) => x.id === active) ?? tabs[0];
  return (
    <section className="card">
      <div className="ledger-head">
        <h2>{t('ledger.title')}</h2>
        <div className="tabs" role="tablist">
          {tabs.map((x) => (
            <button
              key={x.id}
              role="tab"
              aria-selected={tab.id === x.id}
              className={tab.id === x.id ? 'active' : ''}
              onClick={() => setActive(x.id)}
            >
              {x.label} ({x.rows.length})
            </button>
          ))}
        </div>
      </div>
      {tab.rows.length === 0 ? (
        <p className="muted">{t('common.nodata')}</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {tab.columns.map((c) => (
                  <th key={c.key} className={c.num ? 'num' : ''}>
                    {t(c.label)}
                  </th>
                ))}
                <th />
              </tr>
            </thead>
            <tbody>
              {[...tab.rows].reverse().map((row) => (
                <tr key={row.id}>
                  {tab.columns.map((c) => (
                    <td key={c.key} className={c.num ? 'num' : c.muted ? 'muted' : ''}>
                      {c.render(row, t)}
                    </td>
                  ))}
                  <td>
                    <button
                      className="icon danger"
                      title={t('common.delete')}
                      onClick={() => onDelete(tab.endpoint, row.id)}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
