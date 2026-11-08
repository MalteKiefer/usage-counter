import { isTankMeter } from '../lib/meters.js';
import { useState } from 'react';
import { elapsedDays } from '../lib/derive.js';
import { fmt, nowLocalInput, parseNumber } from '../lib/format.js';
import { useSubmit } from '../lib/useSubmit.js';
import { useT } from '../i18n.js';

// A meter with a garden sub-meter is read together with it, in one request.
export default function MeterForm({ meter, garden, readings, unit, gaugeUnit, onSave }) {
  const t = useT();
  const [readAt, setReadAt] = useState(nowLocalInput);
  const [value, setValue] = useState('');
  const [gardenValue, setGardenValue] = useState('');
  const [gauge, setGauge] = useState('');
  const [note, setNote] = useState('');

  const reset = () => {
    setValue('');
    setGardenValue('');
    setGauge('');
    setNote('');
    setReadAt(nowLocalInput());
  };
  const { error, saving, submit, fail } = useSubmit(onSave, reset);

  const hasTank = isTankMeter(meter);
  const isWater = meter.kind === 'water';
  const last = readings.at(-1);
  const valueNum = parseNumber(value);
  const preview = hasTank && value !== '' && readAt && !Number.isNaN(valueNum) ? buildPreview(readings, valueNum, readAt, t) : null;
  const label = isWater ? t('form.waterMeter', { unit }) : t('form.meterValue', { unit });

  function handleSubmit(e) {
    e.preventDefault();
    const main = parseNumber(value);
    const sub = parseNumber(gardenValue);
    const level = gauge === '' ? null : parseNumber(gauge);
    if (Number.isNaN(main) || (gardenValue !== '' && Number.isNaN(sub)) || Number.isNaN(level)) {
      fail(t('form.invalidNumber'));
      return;
    }
    const payloads = [{ meter_id: meter.id, read_at: readAt, meter: main, note }];
    if (hasTank) payloads[0].tank_level = level;
    if (garden && gardenValue !== '') {
      payloads.push({ meter_id: garden.id, read_at: readAt, meter: sub, note });
    }
    submit(payloads);
  }

  return (
    <form className="form" onSubmit={handleSubmit}>
      <label>
        {t('form.dateTime')}
        <input type="datetime-local" value={readAt} onChange={(e) => setReadAt(e.target.value)} required />
      </label>
      <label>
        {label}
        <input
          type="text"
          inputMode="decimal"
          placeholder={last ? t('form.last', { v: fmt(last.meter, 3) }) : label}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          required
        />
      </label>
      {garden && (
        <label>
          {t('form.gardenMeter', { unit })}
          <input
            type="text"
            inputMode="decimal"
            value={gardenValue}
            onChange={(e) => setGardenValue(e.target.value)}
          />
        </label>
      )}
      {hasTank && (
        <label>
          {t('form.gaugeOpt', { unit: gaugeUnit })}
          <input
            type="text"
            inputMode="decimal"
            placeholder={t('form.example', { v: fmt(420, 0) })}
            value={gauge}
            onChange={(e) => setGauge(e.target.value)}
          />
        </label>
      )}
      <label>
        {t('form.note')}
        <input type="text" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>

      {preview && (
        <div className={`preview ${preview.invalid ? 'invalid' : ''}`}>
          {preview.invalid ? (
            <span>{preview.invalid}</span>
          ) : (
            <>
              <strong>
                +{fmt(preview.liters)} {unit}
              </strong>{' '}
              {t('form.inDays', { n: fmt(preview.days) })}
              <span className="muted"> · {fmt(preview.perDay)} {unit}/{t('unit.day')}</span>
            </>
          )}
        </div>
      )}
      {error && <div className="banner error">{error}</div>}

      <button type="submit" className="primary" disabled={saving}>
        {saving ? t('common.saving') : t('form.saveReading')}
      </button>
    </form>
  );
}

// Same neighbour rule as the server: the value must fit between the readings around its time.
function buildPreview(readings, value, readAt, t) {
  if (readings.some((r) => r.read_at === readAt)) return { invalid: t('form.invalidDup') };
  const prev = readings.findLast((r) => r.read_at < readAt);
  const next = readings.find((r) => r.read_at > readAt);
  if (prev && value < prev.meter) return { invalid: t('form.invalidLow') };
  if (next && value > next.meter) return { invalid: t('form.invalidHigh') };
  if (!prev) return null;
  const liters = value - prev.meter;
  const days = elapsedDays(prev.read_at, readAt);
  return { liters, days, perDay: liters / days };
}
