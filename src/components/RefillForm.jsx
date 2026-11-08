import { useState } from 'react';
import { fmt, fmtMoney, nowLocalInput, parseNumber } from '../lib/format.js';
import { useSubmit } from '../lib/useSubmit.js';
import { useT } from '../i18n.js';

export default function RefillForm({ unit, meterUnit, onSave }) {
  const t = useT();
  const [filledAt, setFilledAt] = useState(nowLocalInput);
  const [meter, setMeter] = useState('');
  const [liters, setLiters] = useState('');
  const [total, setTotal] = useState('');
  const [levelAfter, setLevelAfter] = useState('');
  const [note, setNote] = useState('');

  const reset = () => {
    setMeter('');
    setLiters('');
    setTotal('');
    setLevelAfter('');
    setNote('');
    setFilledAt(nowLocalInput());
  };
  const { error, saving, submit, fail } = useSubmit(onSave, reset);

  const litersNum = parseNumber(liters);
  const totalNum = parseNumber(total);
  const pricePerLiter = litersNum > 0 && total !== '' && !Number.isNaN(totalNum) ? totalNum / litersNum : null;

  function handleSubmit(e) {
    e.preventDefault();
    const meterNum = meter === '' ? null : parseNumber(meter);
    const totalValue = total === '' ? null : totalNum;
    const levelNum = levelAfter === '' ? null : parseNumber(levelAfter);
    const values = [meterNum, litersNum, totalValue, levelNum];
    if (values.some((v) => v !== null && Number.isNaN(v))) {
      fail(t('form.invalidNumber'));
      return;
    }
    submit({
      filled_at: filledAt,
      meter: meterNum,
      liters: litersNum,
      total_eur: totalValue,
      level_after: levelNum,
      note,
    });
  }

  return (
    <form className="form" onSubmit={handleSubmit}>
      <label>
        {t('form.dateTime')}
        <input type="datetime-local" value={filledAt} onChange={(e) => setFilledAt(e.target.value)} required />
      </label>
      <label>
        {t('form.refillMeter', { unit: meterUnit })}
        <input
          type="text"
          inputMode="decimal"
          placeholder={t('form.example', { v: fmt(2119.3, 1) })}
          value={meter}
          onChange={(e) => setMeter(e.target.value)}
        />
      </label>
      <label>
        {t('form.liters')} ({unit})
        <input
          type="text"
          inputMode="decimal"
          placeholder={t('form.example', { v: fmt(2500, 0) })}
          value={liters}
          onChange={(e) => setLiters(e.target.value)}
          required
        />
      </label>
      <label>
        {t('form.total')}
        <input
          type="text"
          inputMode="decimal"
          placeholder={t('form.example', { v: fmt(2100.5, 2) })}
          value={total}
          onChange={(e) => setTotal(e.target.value)}
        />
      </label>
      <label>
        {t('form.levelAfter', { unit })}
        <input
          type="text"
          inputMode="decimal"
          placeholder={t('form.emptyFull')}
          value={levelAfter}
          onChange={(e) => setLevelAfter(e.target.value)}
        />
      </label>
      <label>
        {t('form.note')}
        <input type="text" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>

      {pricePerLiter !== null && Number.isFinite(pricePerLiter) && (
        <div className="preview">
          <strong>{fmtMoney(pricePerLiter)}</strong>
          <span className="muted"> {t('form.perLiter', { unit })}</span>
        </div>
      )}
      {error && <div className="banner error">{error}</div>}

      <button type="submit" className="primary" disabled={saving}>
        {saving ? t('common.saving') : t('form.saveRefill')}
      </button>
    </form>
  );
}
