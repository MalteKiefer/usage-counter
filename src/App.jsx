import { useCallback, useEffect, useRef, useState } from 'react';
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
  fetchSession,
  fetchTankLevels,
  logout,
  savePreferences,
  updateMeter,
  updateObject,
  errorText,
} from './api.js';
import { BackupPanel, MeterPanel, ObjectPanel, SettingsPanel } from './components/Panels.jsx';
import LoginScreen from './components/LoginScreen.jsx';
import Modal from './components/Modal.jsx';
import { I18nContext, translator } from './i18n.js';
import { loadPrefs, loadSelectedObject, savePrefs, saveSelectedObject } from './lib/prefs.js';
import { serial } from './lib/queue.js';
import { setFormatPrefs } from './lib/format.js';
import MeterView from './views/MeterView.jsx';

const REPO_URL = 'https://github.com/MalteKiefer/usage-counter';

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

const PANEL_TITLES = {
  'object-new': 'object.new',
  'object-edit': 'object.edit',
  meters: 'meter.manage',
  backup: 'backup.button',
  settings: 'settings.title',
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

// No data may load before the server confirms the session, so the check runs first.
export default function App() {
  const [session, setSession] = useState(null);
  const [sessionError, setSessionError] = useState(null);
  const t = translator(loadPrefs().lang);

  useEffect(() => {
    fetchSession()
      .then(setSession)
      .catch((err) => setSessionError(err));
  }, []);

  if (sessionError) return <div className="banner error">{errorText(sessionError, t)}</div>;
  if (!session) return null;
  if (session.auth.enabled && !session.user) {
    return (
      <I18nContext.Provider value={t}>
        <LoginScreen />
      </I18nContext.Provider>
    );
  }
  return <Main user={session.user} />;
}

function Main({ user }) {
  const [prefs, setPrefs] = useState(() => user?.prefs ?? loadPrefs());
  // Preference saves go out in order, so the last change is the one the server keeps.
  const [queuePrefs] = useState(serial);
  const t = translator(prefs.lang);
  setFormatPrefs(prefs);

  const [objects, setObjects] = useState([]);
  const [objectId, setObjectId] = useState(loadSelectedObject);
  const [data, setData] = useState(EMPTY_DATA);
  const [meterId, setMeterId] = useState(null);
  const [range, setRange] = useState(RANGES[1]);
  const [panel, setPanel] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [error, setError] = useState(null);
  const menuToggle = useRef(null);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const close = (e) => {
      if (!e.target.closest?.('.menu')) setMenuOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

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
        if (active) setError(err);
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
        if (active) setError(err);
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
      setError(errorText(err, t));
    }
  }

  async function refreshObject() {
    if (objectId == null) return;
    try {
      setData(await loadObjectData(objectId));
      setError(null);
    } catch (err) {
      setError(errorText(err, t));
    }
  }

  function changePrefs(next) {
    savePrefs(next);
    setPrefs(next);
    if (user) queuePrefs(() => savePreferences(next)).catch((err) => setError(errorText(err, t)));
  }

  async function signOut() {
    try {
      await logout();
      window.location.assign('/');
    } catch (err) {
      setError(errorText(err, t));
    }
  }

  // Focus moves to the menu button first, so the dialog returns focus there when it closes.
  function openPanel(name) {
    menuToggle.current?.focus();
    setMenuOpen(false);
    setPanel(name);
  }

  const closePanel = useCallback(() => setPanel(null), []);

  const actions = {
    // Several meters at one moment go in one request, so either all or none are saved.
    saveMeters: async (payloads) => {
      try {
        await createReadings(payloads);
      } finally {
        await refreshObject();
      }
    },
    saveRefill: async (meterId, body) => {
      await createRefill(meterId, body);
      await refreshObject();
    },
    saveTankLevel: async (meterId, body) => {
      await createTankLevel(meterId, body);
      await refreshObject();
    },
    saveTankSize: async (meterId, size) => {
      await updateMeter(meterId, { tank_size: size });
      await refreshObject();
    },
    remove: async (endpoint, id) => {
      if (!window.confirm(t('app.deleteEntry'))) return;
      try {
        await DELETE_ENDPOINTS[endpoint](id);
        await refreshObject();
      } catch (err) {
        setError(errorText(err, t));
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

  async function restoredBackup() {
    setObjectId(null);
    await refreshObjects();
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

  async function updateMeterInfo(id, body) {
    await updateMeter(id, body);
    await refreshObject();
  }

  async function removeMeter(id) {
    await deleteMeter(id);
    await refreshObject();
  }

  return (
    <I18nContext.Provider value={t}>
      <div className="app" lang={prefs.lang}>
        <header className="appbar">
          <h1 className="brand">
            <span className="flame">🔥</span> {t('app.title')}
          </h1>
          {user && (
            <div className="user">
              {user.picture && <img src={user.picture} alt="" width="28" height="28" />}
              <span className="user-name">{user.name}</span>
              <button className="ghost" onClick={signOut}>{t('user.logout')}</button>
            </div>
          )}
          <div className="menu">
            <button
              ref={menuToggle}
              className="ghost"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((open) => !open)}
            >
              {t('menu.manage')} ▾
            </button>
              {menuOpen && (
                <div className="menu-list" role="menu">
                  {object && (
                    <button role="menuitem" onClick={() => openPanel('object-edit')}>{t('object.edit')}</button>
                  )}
                  {object && (
                    <button role="menuitem" onClick={() => openPanel('meters')}>{t('meter.manage')}</button>
                  )}
                  <button role="menuitem" onClick={() => openPanel('backup')}>{t('backup.button')}</button>
                  <button role="menuitem" onClick={() => openPanel('settings')}>{t('settings.title')}</button>
                </div>
              )}
            </div>
        </header>

        <section className="hero">
          <p className="muted">{t('app.subtitle')}</p>
          <div className="range" role="group" aria-label={t('app.period')}>
            {RANGES.map((r) => (
              <button key={r.label} className={r.days === range.days ? 'active' : ''} onClick={() => setRange(r)}>
                {t(r.label)}
              </button>
            ))}
          </div>
        </section>

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
          <button className="primary" onClick={() => openPanel('object-new')}>+ {t('object.new')}</button>
        </section>

        {error && <div className="banner error">{errorText(error, t)}</div>}

        {panel && (
          <Modal title={t(PANEL_TITLES[panel])} onClose={closePanel}>
            {panel === 'object-new' && <ObjectPanel onSave={saveObject} onClose={closePanel} />}
            {panel === 'object-edit' && object && (
              <ObjectPanel
                key={object.id}
                object={object}
                onSave={saveObject}
                onDelete={removeObject}
                onClose={closePanel}
              />
            )}
            {panel === 'meters' && object && (
              <MeterPanel
                meters={data.meters}
                onAdd={addMeter}
                onUpdate={updateMeterInfo}
                onDelete={removeMeter}
              />
            )}
            {panel === 'backup' && <BackupPanel onRestored={restoredBackup} onClose={closePanel} />}
            {panel === 'settings' && (
              <SettingsPanel prefs={prefs} onChange={changePrefs} onClose={closePanel} />
            )}
          </Modal>
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
                  {m.name}
                  {m.name !== t(`kind.${m.kind}`) && <span className="small"> · {t(`kind.${m.kind}`)}</span>}
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
                range={range}
                actions={actions}
              />
            )}
          </>
        )}
        <footer className="app-footer">
          <a href={REPO_URL} target="_blank" rel="noopener noreferrer">{t('app.title')}</a>
          <span>
            {t('footer.version')} {__APP_VERSION__}
          </span>
        </footer>
      </div>
    </I18nContext.Provider>
  );
}
