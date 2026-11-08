import { useState } from 'react';

// Tabs only when there is more than one entry form.
export default function EntryCard({ tabs }) {
  const [active, setActive] = useState(tabs[0].id);
  const current = tabs.find((t) => t.id === active) ?? tabs[0];
  return (
    <section className="card entry">
      {tabs.length > 1 && (
        <div className="tabs" role="tablist">
          {tabs.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={current.id === t.id}
              className={current.id === t.id ? 'active' : ''}
              onClick={() => setActive(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}
      {current.node}
    </section>
  );
}
