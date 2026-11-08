import { useEffect, useState } from 'react';
import {
  createMeter,
  createObject,
  createReadings,
  createRefill,
  createTankLevel,
  deleteMeter,
  deleteObject,
  deleteReading,
  deleteRefill,
  deleteTankLevel,
  fetchMeters,
  fetchObjects,
  fetchReadings,
  fetchRefills,
  fetchTankLevels,
  updateObject,
} from './api.js';
import { MeterPanel, ObjectPanel, SettingsPanel } from './components/Panels.jsx';
import { I18nContext, translator } from './i18n.js';
import { loadPrefs, loadSelectedObject, savePrefs, saveSelectedObject } from './lib/prefs.js';
import { setFormatPrefs } from './lib/format.js';
import MeterView from './views/MeterView.jsx';

const RANGES = [
  { label: 'range.30', days: 30 },
  { label: 'range.90', days: 90 },
  { label: 'range.120', days: 120 },
  { label: 'range.365', days: 365 },
  { label: 'range.all', days: null },
];

const DELETE_ENDPOINTS = {
  readings: deleteReading,
  refills: deleteRefill,
  'tank-levels': deleteTankLevel,
};

const EMPTY_DATA = { meters: [], readings: [], refills: [], levels: [] };

async function loadObjectData(id) {
  const [meters, readings, refills, levels] = await Promise.all([
    fetchMeters(id),
    fetchReadings(id),
    fetchRefills(id),
    fetchTankLevels(id),
  ]);
  return { meters, readings, refills, levels };
}

export default function App() {
  const [prefs, setPrefs] = useState(loadPrefs);
  const t = translator(prefs.lang);
  setFormatPrefs(prefs);

  const [objects, setObjects] = useState([]);
  const [objectId, setObjectId] = useState(loadSelectedObject);
  const [data, setData] = useState(EMPTY_DATA);
  const [meterId, setMeterId] = useState(null);
  const [range, setRange] = useState(RANGES[1]);
  const [panel, setPanel] = useState(null);
  const [error, setError] = useState(null);

  const object = objects.find((o) => o.id === objectId) ?? null;
  const meter = data.meters.find((m) => m.id === meterId) ?? data.meters[0] ?? null;

  useEffect(() => {
    document.documentElement.lang = prefs.lang;
    document.title = t('app.title');
  }, [prefs.lang, t]);

  // Load the object list on start; keep the saved selection when it still exists.
  useEffect(() => {
    let active = true;
    fetchObjects()
      .then((rows) => {
        if (!active) return;
        setObjects(rows);
        setObjectId((current) => (rows.some((o) => o.id === current) ? current : (rows[0]?.id ?? null)));
      })
      .catch((err) => {
        if (active) setError(err.message);
      });
    return () => {
      active = false;
    };
  }, []);

  // Load everything of the selected object whenever the selection changes.
  useEffect(() => {
    if (objectId == null) return undefined;
    saveSelectedObject(objectId);
    let active = true;
    loadObjectData(objectId)
      .then((loaded) => {
        if (!active) return;
        setData(loaded);
        setError(null);
      })
      .catch((err) => {
        if (active) setError(err.message);
      });
    return () => {
      active = false;
    };
  }, [objectId]);

  async function refreshObjects() {
    try {
      const rows = await fetchObjects();
      setObjects(rows);
      setObjectId((current) => (rows.some((o) => o.id === current) ? current : (rows[0]?.id ?? null)));
    } catch (err) {
      setError(err.message);
    }
  }

  async function refreshObject() {
    if (objectId == null) return;
    try {
      setData(await loadObjectData(objectId));
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  }

  function changePrefs(next) {
    savePrefs(next);
    setPrefs(next);
  }

  function togglePanel(name) {
    setPanel((current) => (current === name ? null : name));
  }

  const actions = {
    // Several meters at one moment go in one request, so either all or none are saved.
    saveMeters: async (payloads) => {
      try {
        await createReadings(payloads);
      } finally {
        await refreshObject();
      }
    },
    saveRefill: async (body) => {
      await createRefill(objectId, body);
      await refreshObject();
    },
    saveTankLevel: async (body) => {
      await createTankLevel(objectId, body);
      await refreshObject();
    },
    saveTankSize: async (size) => {
      await updateObject(objectId, { tank_size: size });
      await refreshObjects();
    },
    remove: async (endpoint, id) => {
      if (!window.confirm(t('app.deleteEntry'))) return;
      try {
        await DELETE_ENDPOINTS[endpoint](id);
        await refreshObject();
      } catch (err) {
        setError(err.message);
      }
    },
  };

  async function saveObject(payload, id) {
    if (id == null) {
      const created = await createObject(payload);
      await refreshObjects();
      setObjectId(created.id);
    } else {
      await updateObject(id, payload);
      await refreshObjects();
    }
  }

  async function removeObject(id) {
    await deleteObject(id);
    setObjectId(null);
    await refreshObjects();
  }

  async function addMeter(payload) {
    await createMeter(objectId, payload);
    await refreshObject();
  }

  async function removeMeter(id) {
    await deleteMeter(id);
    await refreshObject();
  }

  return (
    <I18nContext.Provider value={t}>
      <div className="app" lang={prefs.lang}>
        <header className="hero">
          <div>
            <h1>
              <span className="flame">🔥</span> {t('app.title')}
            </h1>
            <p className="muted">{t('app.subtitle')}</p>
          </div>
          <div className="range" role="group" aria-label={t('app.period')}>
            {RANGES.map((r) => (
              <button key={r.label} className={r.days === range.days ? 'active' : ''} onClick={() => setRange(r)}>
                {t(r.label)}
              </button>
            ))}
          </div>
        </header>

        <section className="card toolbar">
          <label>
            {t('object.label')}
            <select
              value={objectId ?? ''}
              onChange={(e) => setObjectId(Number(e.target.value))}
              disabled={!objects.length}
            >
              {objects.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </label>
          <div className="toolbar-actions">
            <button className="ghost" onClick={() => togglePanel('object-new')}>{t('object.new')}</button>
            {object && <button className="ghost" onClick={() => togglePanel('object-edit')}>{t('object.edit')}</button>}
            {object && <button className="ghost" onClick={() => togglePanel('meters')}>{t('meter.add')}</button>}
            <button className="ghost" onClick={() => togglePanel('settings')}>{t('settings.title')}</button>
          </div>
        </section>

        {error && <div className="banner error">{error}</div>}

        {panel === 'object-new' && <ObjectPanel onSave={saveObject} onClose={() => setPanel(null)} />}
        {panel === 'object-edit' && object && (
          <ObjectPanel
            key={object.id}
            object={object}
            onSave={saveObject}
            onDelete={removeObject}
            onClose={() => setPanel(null)}
          />
        )}
        {panel === 'meters' && object && (
          <MeterPanel meters={data.meters} onAdd={addMeter} onDelete={removeMeter} />
        )}
        {panel === 'settings' && (
          <SettingsPanel prefs={prefs} onChange={changePrefs} onClose={() => setPanel(null)} />
        )}

        {!object && <p className="muted">{t('app.noObject')}</p>}

        {object && (
          <>
            <nav className="tabs main-tabs" role="tablist">
              {data.meters.map((m) => (
                <button
                  key={m.id}
                  role="tab"
                  aria-selected={meter?.id === m.id}
                  className={meter?.id === m.id ? 'active' : ''}
                  onClick={() => setMeterId(m.id)}
                >
                  {m.name} <span className="small">· {t(`kind.${m.kind}`)}</span>
                </button>
              ))}
            </nav>
            {data.meters.length === 0 && <p className="muted">{t('app.noMeter')}</p>}
            {meter && (
              <MeterView
                key={meter.id}
                meter={meter}
                meters={data.meters}
                readings={data.readings}
                refills={data.refills}
                tankLevels={data.levels}
                object={object}
                range={range}
                actions={actions}
              />
            )}
          </>
        )}
      </div>
    </I18nContext.Provider>
  );
}
