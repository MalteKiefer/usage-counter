// Preferences kept in this browser: language, number, date and currency formats.
import { DEFAULT_PREFS, normalizePrefs, prefsError } from './locale.js';

const PREFS_KEY = 'oil-prefs';
const SELECTED_KEY = 'oil-object';

export function loadPrefs() {
  try {
    const prefs = normalizePrefs(JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}'));
    return prefsError(prefs) ? DEFAULT_PREFS : prefs;
  } catch (err) {
    console.warn('Stored preferences are unreadable, using defaults', err);
    return DEFAULT_PREFS;
  }
}

export function savePrefs(prefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch (err) {
    console.warn('Preferences could not be stored', err);
  }
}

export function loadSelectedObject() {
  try {
    return Number(localStorage.getItem(SELECTED_KEY)) || null;
  } catch (err) {
    console.warn('Stored object selection is unreadable', err);
    return null;
  }
}

export function saveSelectedObject(id) {
  try {
    localStorage.setItem(SELECTED_KEY, String(id));
  } catch (err) {
    console.warn('Object selection could not be stored', err);
  }
}
