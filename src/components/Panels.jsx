import { useState } from 'react';
import { useT } from '../i18n.js';
import { fmt, parseNumber } from '../lib/format.js';
import { tankUnitLabel } from '../lib/units.js';
import { DEFAULT_LPG_DENSITY, SERIAL_KINDS, TANK_KINDS } from '../lib/meters.js';
import { CURRENCIES, DATE_ORDERS, LANGUAGES, NUMBER_LOCALES } from '../lib/locale.js';
import { errorText, fetchBackup, restoreBackup } from '../api.js';

// Create a new object, or edit the selected one.
export function ObjectPanel({ object, onSave, onDelete, onClose }) {
  const t = useT();
  const [name, setName] = useState(object?.name ?? '');
  const [error, setError] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setError(null);
    try {
      await onSave({ name }, object?.id ?? null);
      onClose();
    } catch (err) {
      setError(errorText(err, t));
    }
  }

  async function remove() {
    if (!window.confirm(t('object.deleteConfirm', { name: object.name }))) return;
    try {
      await onDelete(object.id);
      onClose();
    } catch (err) {
      setError(errorText(err, t));
    }
  }

  return (
    <section className="card panel">
      <h2>{object ? t('object.edit') : t('object.new')}</h2>
      <form className="form" onSubmit={submit}>
        <label>
          {t('object.name')}
          <input type="text" maxLength={100} value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        {error && <div className="banner error">{error}</div>}
        <div className="inline">
          <button type="submit" className="primary">
            {object ? t('object.save') : t('object.create')}
          </button>
          {object && (
            <button type="button" className="ghost danger-text" onClick={remove}>
              {t('object.delete')}
            </button>
          )}
        </div>
      </form>
    </section>
  );
}

// Meters of the selected object: list with edit and delete, and a form to add one.
const tankValue = (text) => (text === '' ? null : parseNumber(text));

export function MeterPanel({ meters, onAdd, onUpdate, onDelete }) {
  const t = useT();
  const [kind, setKind] = useState('oil');
  const [name, setName] = useState('');
  const [serial, setSerial] = useState('');
  const [tankSize, setTankSize] = useState('');
  const [tankUnit, setTankUnit] = useState('l');
  const [density, setDensity] = useState('');
  const [subOf, setSubOf] = useState('');
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState(null);
  const waterMeters = meters.filter((m) => m.kind === 'water' && m.sub_of == null);
  const nameOf = (id) => meters.find((m) => m.id === id)?.name ?? '';

  async function submit(e) {
    e.preventDefault();
    setError(null);
    try {
      const size = TANK_KINDS.includes(kind) ? tankValue(tankSize) : null;
      const lpgDensity = kind === 'gas' ? tankValue(density) : null;
      if (Number.isNaN(size) || Number.isNaN(lpgDensity)) throw new Error(t('form.invalidNumber'));
      await onAdd({
        kind,
        name,
        serial: SERIAL_KINDS.includes(kind) ? serial : null,
        tank_size: size,
        tank_unit: kind === 'gas' ? tankUnit : 'l',
        tank_density: lpgDensity,
        sub_of: kind === 'water' && subOf !== '' ? Number(subOf) : null,
      });
      setName('');
      setSerial('');
      setTankSize('');
      setTankUnit('l');
      setDensity('');
      setSubOf('');
    } catch (err) {
      setError(errorText(err, t));
    }
  }

  function startEdit(meter) {
    setError(null);
    setEditing({
      id: meter.id,
      kind: meter.kind,
      name: meter.name,
      serial: meter.serial ?? '',
      tank: meter.tank_size ?? '',
      unit: meter.tank_unit ?? 'l',
      density: meter.tank_density ?? '',
    });
  }

  async function saveEdit(e) {
    e.preventDefault();
    setError(null);
    try {
      const body = { name: editing.name, serial: editing.serial };
      if (TANK_KINDS.includes(editing.kind)) {
        body.tank_size = tankValue(String(editing.tank));
        body.tank_unit = editing.kind === 'gas' ? editing.unit : 'l';
      }
      if (editing.kind === 'gas') body.tank_density = tankValue(String(editing.density));
      if ([body.tank_size, body.tank_density].some((value) => value !== undefined && Number.isNaN(value))) {
        throw new Error(t('form.invalidNumber'));
      }
      await onUpdate(editing.id, body);
      setEditing(null);
    } catch (err) {
      setError(errorText(err, t));
    }
  }

  async function remove(meter) {
    if (!window.confirm(t('meter.deleteConfirm', { name: meter.name }))) return;
    try {
      await onDelete(meter.id);
    } catch (err) {
      setError(errorText(err, t));
    }
  }

  return (
    <section className="card panel">
      <h2>{t('meter.manage')}</h2>
      <ul className="meter-list">
        {meters.map((m) =>
          editing?.id === m.id ? (
            <li key={m.id}>
              <form className="form" onSubmit={saveEdit}>
                <div className="grid-2">
                  <label>
                    {t('meter.name')}
                    <input
                      type="text"
                      maxLength={100}
                      value={editing.name}
                      onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                      required
                    />
                  </label>
                  {SERIAL_KINDS.includes(m.kind) && (
                    <label>
                      {t('meter.serial')}
                      <input
                        type="text"
                        maxLength={50}
                        value={editing.serial}
                        onChange={(e) => setEditing({ ...editing, serial: e.target.value })}
                      />
                    </label>
                  )}
                  {TANK_KINDS.includes(m.kind) && (
                    <label>
                      {t('object.tankSize')} ({tankUnitLabel(editing.unit)})
                      <input
                        type="text"
                        placeholder={t('meter.tankHint')}
                        value={editing.tank}
                        onChange={(e) => setEditing({ ...editing, tank: e.target.value })}
                      />
                    </label>
                  )}
                  {m.kind === 'gas' && (
                    <label>
                      {t('meter.tankUnit')}
                      <select value={editing.unit} onChange={(e) => setEditing({ ...editing, unit: e.target.value })}>
                        <option value="l">{t('unit.litre')}</option>
                        <option value="kg">{t('unit.kilo')}</option>
                      </select>
                    </label>
                  )}
                  {m.kind === 'gas' && (
                    <label>
                      {t('meter.density')}
                      <input
                        type="text"
                        inputMode="decimal"
                        placeholder={fmt(DEFAULT_LPG_DENSITY, 2)}
                        value={editing.density}
                        onChange={(e) => setEditing({ ...editing, density: e.target.value })}
                      />
                    </label>
                  )}
                </div>
                <div>
                  <button type="submit" className="primary">{t('common.save')}</button>{' '}
                  <button type="button" className="ghost" onClick={() => setEditing(null)}>{t('common.cancel')}</button>
                </div>
              </form>
            </li>
          ) : (
            <li key={m.id}>
              <span>
                <strong>{m.name}</strong> <span className="muted small">{t(`kind.${m.kind}`)}</span>
                {m.serial && <span className="muted small"> · {t('meter.serial')} {m.serial}</span>}
                {m.sub_of != null && <span className="muted small"> · {nameOf(m.sub_of)}</span>}
              </span>
              <span className="row-actions">
                <button className="ghost" onClick={() => startEdit(m)}>{t('meter.edit')}</button>
                <button className="icon danger" title={t('common.delete')} onClick={() => remove(m)}>
                  ✕
                </button>
              </span>
            </li>
          ),
        )}
      </ul>
      <form className="form" onSubmit={submit}>
        <div className="grid-2">
          <label>
            {t('meter.kind')}
            <select value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="oil">{t('kind.oil')}</option>
              <option value="water">{t('kind.water')}</option>
              <option value="power">{t('kind.power')}</option>
              <option value="gas">{t('kind.gas')}</option>
            </select>
          </label>
          <label>
            {t('meter.name')}
            <input type="text" maxLength={100} value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
        </div>
        {SERIAL_KINDS.includes(kind) && (
          <label>
            {t('meter.serial')}
            <input type="text" maxLength={50} value={serial} onChange={(e) => setSerial(e.target.value)} />
            <span className="muted small">{t('meter.serialHint')}</span>
          </label>
        )}
        {TANK_KINDS.includes(kind) && (
          <label>
            {t('object.tankSize')} ({tankUnitLabel(kind === 'gas' ? tankUnit : 'l')})
            <input
              type="text"
              placeholder={t('meter.tankHint')}
              value={tankSize}
              onChange={(e) => setTankSize(e.target.value)}
            />
          </label>
        )}
        {kind === 'gas' && (
          <label>
            {t('meter.tankUnit')}
            <select value={tankUnit} onChange={(e) => setTankUnit(e.target.value)}>
              <option value="l">{t('unit.litre')}</option>
              <option value="kg">{t('unit.kilo')}</option>
            </select>
          </label>
        )}
        {kind === 'gas' && (
          <label>
            {t('meter.density')}
            <input
              type="text"
              inputMode="decimal"
              placeholder={fmt(DEFAULT_LPG_DENSITY, 2)}
              value={density}
              onChange={(e) => setDensity(e.target.value)}
            />
            <span className="muted small">{t('meter.densityHint')}</span>
          </label>
        )}
        {kind === 'water' && waterMeters.length > 0 && (
          <label>
            {t('meter.sub')}
            <select value={subOf} onChange={(e) => setSubOf(e.target.value)}>
              <option value="">{t('meter.none')}</option>
              {waterMeters.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
            <span className="muted small">{t('meter.subHint')}</span>
          </label>
        )}
        {error && <div className="banner error">{error}</div>}
        <button type="submit" className="primary">{t('meter.create')}</button>
      </form>
    </section>
  );
}

// Per-browser preferences: language, number and date format.
// Language, number format, date order and currency. Options come from the locale registry.
export function SettingsPanel({ prefs, onChange, onClose }) {
  const t = useT();
  const example = (locale) => new Intl.NumberFormat(locale).format(1234.5);
  const dateExample = { dmy: '31.12.2026', ymd: '2026-12-31', mdy: '12/31/2026' };
  const currencyName = (code) => new Intl.DisplayNames(prefs.lang, { type: 'currency' }).of(code);
  const set = (key) => (e) => onChange({ ...prefs, [key]: e.target.value });
  return (
    <section className="card panel">
      <h2>{t('settings.title')}</h2>
      <div className="grid-2">
        <label>
          {t('settings.lang')}
          <select value={prefs.lang} onChange={set('lang')}>
            {Object.entries(LANGUAGES).map(([code, lang]) => (
              <option key={code} value={code}>{lang.name}</option>
            ))}
          </select>
        </label>
        <label>
          {t('settings.numbers')}
          <select value={prefs.locale} onChange={set('locale')}>
            {NUMBER_LOCALES.map((locale) => (
              <option key={locale} value={locale}>{`${locale} · ${example(locale)}`}</option>
            ))}
          </select>
        </label>
        <label>
          {t('settings.dates')}
          <select value={prefs.dates} onChange={set('dates')}>
            {DATE_ORDERS.map((order) => (
              <option key={order} value={order}>{dateExample[order]}</option>
            ))}
          </select>
        </label>
        <label>
          {t('settings.currency')}
          <select value={prefs.currency} onChange={set('currency')}>
            {CURRENCIES.map((code) => (
              <option key={code} value={code}>{`${code} · ${currencyName(code)}`}</option>
            ))}
          </select>
        </label>
      </div>
      <div>
        <button className="ghost" onClick={onClose}>{t('common.close')}</button>
      </div>
    </section>
  );
}

export function BackupPanel({ onRestored, onClose }) {
  const t = useT();
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);

  async function download() {
    setError(null);
    try {
      const blob = await fetchBackup();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `usage-counter-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      setError(errorText(err, t));
    }
  }

  async function restore(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError(null);
    setMessage(null);
    if (!window.confirm(t('backup.restoreConfirm'))) return;
    try {
      const counts = await restoreBackup(await file.text());
      setMessage(t('backup.done', counts));
      onRestored();
    } catch (err) {
      setError(errorText(err, t));
    }
  }

  return (
    <section className="card panel">
      <h2>{t('backup.title')}</h2>
      <p className="muted small">{t('backup.hint')}</p>
      <div className="inline">
        <button className="primary" onClick={download}>{t('backup.download')}</button>
        <label className="file-button">
          {t('backup.restore')}
          <input type="file" accept="application/json,.json" onChange={restore} hidden />
        </label>
      </div>
      {message && <div className="banner">{message}</div>}
      {error && <div className="banner error">{error}</div>}
      <div>
        <button className="ghost" onClick={onClose}>{t('common.close')}</button>
      </div>
    </section>
  );
}
