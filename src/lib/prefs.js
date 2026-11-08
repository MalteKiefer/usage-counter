// Per-browser preferences until accounts exist: language and number and date formats.
const PREFS_KEY = 'oil-prefs';
const SELECTED_KEY = 'oil-object';
const DEFAULTS = { lang: 'de', numbers: 'de', dates: 'dmy' };

export function loadPrefs() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') };
  } catch (err) {
    console.warn('Einstellungen nicht lesbar, Standard wird genutzt', err);
    return DEFAULTS;
  }
}

export function savePrefs(prefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch (err) {
    console.warn('Einstellungen nicht speicherbar', err);
  }
}

export function loadSelectedObject() {
  try {
    return Number(localStorage.getItem(SELECTED_KEY)) || null;
  } catch (err) {
    console.warn('Auswahl nicht lesbar', err);
    return null;
  }
}

export function saveSelectedObject(id) {
  try {
    localStorage.setItem(SELECTED_KEY, String(id));
  } catch (err) {
    console.warn('Auswahl nicht speicherbar', err);
  }
}
