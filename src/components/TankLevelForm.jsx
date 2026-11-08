import { useState } from 'react';
import { fmt, nowLocalInput, parseNumber } from '../lib/format.js';
import { useSubmit } from '../lib/useSubmit.js';
import { useT } from '../i18n.js';

// Gauge value on its own. It anchors the estimate only with a meter reading in the same minute.
export default function TankLevelForm({ onSave }) {
  const t = useT();
  const [readAt, setReadAt] = useState(nowLocalInput);
  const [level, setLevel] = useState('');
  const [note, setNote] = useState('');

  const reset = () => {
    setLevel('');
    setNote('');
    setReadAt(nowLocalInput());
  };
  const { error, saving, submit, fail } = useSubmit(onSave, reset);

  function handleSubmit(e) {
    e.preventDefault();
    const value = parseNumber(level);
    if (Number.isNaN(value)) {
      fail(t('form.invalidNumber'));
      return;
    }
    submit({ read_at: readAt, level: value, note });
  }

  return (
    <form className="form" onSubmit={handleSubmit}>
      <label>
        {t('form.dateTime')}
        <input type="datetime-local" value={readAt} onChange={(e) => setReadAt(e.target.value)} required />
      </label>
      <label>
        {t('form.gaugeLevel')}
        <input
          type="text"
          inputMode="decimal"
          placeholder="z. B. 420"
          value={level}
          onChange={(e) => setLevel(e.target.value)}
          required
        />
      </label>
      <label>
        {t('form.note')}
        <input type="text" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      {error && <div className="banner error">{error}</div>}
      <button type="submit" className="primary" disabled={saving}>
        {saving
          ? t('common.saving')
          : level
            ? t('form.saveGaugeVal', { v: fmt(parseNumber(level)) })
            : t('form.saveGauge')}
      </button>
    </form>
  );
}
