export default function StatCards({ cards }) {
  return (
    <div className="stats">
      {cards.map((c) => (
        <div key={c.label} className="card stat">
          <span className="stat-label">{c.label}</span>
          <span className="stat-value">{c.value}</span>
          <span className="stat-sub">{c.sub}</span>
        </div>
      ))}
    </div>
  );
}
