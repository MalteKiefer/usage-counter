import { useState } from 'react';
import { useT } from '../i18n.js';
import { parseNumber } from '../lib/format.js';
import { fetchBackup, restoreBackup } from '../api.js';

// Create a new object, or edit the selected one.
export function ObjectPanel({ object, onSave, onDelete, onClose }) {
  const t = useT();
  const [name, setName] = useState(object?.name ?? '');
  const [tankSize, setTankSize] = useState(object?.tank_size ?? '');
  const [error, setError] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setError(null);
    try {
      const size = tankSize === '' ? null : parseNumber(tankSize);
      if (Number.isNaN(size)) throw new Error(t('form.invalidNumber'));
      await onSave({ name, tank_size: size }, object?.id ?? null);
      onClose();
    } catch (err) {
      setError(err.message);
    }
  }

  async function remove() {
    if (!window.confirm(t('object.deleteConfirm', { name: object.name }))) return;
    try {
      await onDelete(object.id);
      onClose();
    } catch (err) {
      setError(err.message);
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
        <label>
          {t('object.tankSize')}
          <input
            type="text"
            placeholder="z. B. 750"
            value={tankSize}
            onChange={(e) => setTankSize(e.target.value)}
          />
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

// Meters of the selected object: list with delete, and a form to add one.
export function MeterPanel({ meters, onAdd, onDelete }) {
  const t = useT();
  const [kind, setKind] = useState('oil');
  const [name, setName] = useState('');
  const [subOf, setSubOf] = useState('');
  const [error, setError] = useState(null);
  const waterMeters = meters.filter((m) => m.kind === 'water' && m.sub_of == null);
  const nameOf = (id) => meters.find((m) => m.id === id)?.name ?? '';

  async function submit(e) {
    e.preventDefault();
    setError(null);
    try {
      await onAdd({ kind, name, sub_of: kind === 'water' && subOf !== '' ? Number(subOf) : null });
      setName('');
      setSubOf('');
    } catch (err) {
      setError(err.message);
    }
  }

  async function remove(meter) {
    if (!window.confirm(t('meter.deleteConfirm', { name: meter.name }))) return;
    try {
      await onDelete(meter.id);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <section className="card panel">
      <h2>{t('meter.manage')}</h2>
      <ul className="meter-list">
        {meters.map((m) => (
          <li key={m.id}>
            <span>
              <strong>{m.name}</strong> <span className="muted small">{t(`kind.${m.kind}`)}</span>
              {m.sub_of != null && <span className="muted small"> · {nameOf(m.sub_of)}</span>}
            </span>
            <button className="icon danger" title={t('common.delete')} onClick={() => remove(m)}>
              ✕
            </button>
          </li>
        ))}
      </ul>
      <form className="form" onSubmit={submit}>
        <div className="grid-2">
          <label>
            {t('meter.kind')}
            <select value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="oil">{t('kind.oil')}</option>
              <option value="water">{t('kind.water')}</option>
              <option value="power">{t('kind.power')}</option>
            </select>
          </label>
          <label>
            {t('meter.name')}
            <input type="text" maxLength={100} value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
        </div>
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
export function SettingsPanel({ prefs, onChange, onClose }) {
  const t = useT();
  return (
    <section className="card panel">
      <h2>{t('settings.title')}</h2>
      <div className="grid-3">
        <label>
          {t('settings.lang')}
          <select value={prefs.lang} onChange={(e) => onChange({ ...prefs, lang: e.target.value })}>
            <option value="de">{t('lang.de')}</option>
            <option value="en">{t('lang.en')}</option>
          </select>
        </label>
        <label>
          {t('settings.numbers')}
          <select value={prefs.numbers} onChange={(e) => onChange({ ...prefs, numbers: e.target.value })}>
            <option value="de">{t('settings.numbersDe')}</option>
            <option value="en">{t('settings.numbersEn')}</option>
          </select>
        </label>
        <label>
          {t('settings.dates')}
          <select value={prefs.dates} onChange={(e) => onChange({ ...prefs, dates: e.target.value })}>
            <option value="dmy">{t('settings.datesDmy')}</option>
            <option value="ymd">{t('settings.datesYmd')}</option>
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
      setError(err.message);
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
      setError(err.message);
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
