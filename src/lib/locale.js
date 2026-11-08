// Every choice the user can make about language and formats lives here. The browser and the server
// both read it, so adding a language, number format or currency is one entry in one place.

export const LANGUAGES = {
  de: { name: 'Deutsch', fallback: 'en' },
  en: { name: 'English', fallback: null },
};

// Number and date formats follow a locale tag. The example shows how the separators look.
export const NUMBER_LOCALES = ['de-DE', 'de-CH', 'en-US', 'en-GB', 'fr-FR', 'es-ES', 'it-IT', 'nl-NL', 'pl-PL', 'sv-SE'];

// Date order: day first, year first, or month first.
export const DATE_ORDERS = ['dmy', 'ymd', 'mdy'];

export const CURRENCIES = ['EUR', 'USD', 'GBP', 'CHF', 'SEK', 'PLN'];

export const DEFAULT_PREFS = Object.freeze({
  lang: 'de',
  locale: 'de-DE',
  dates: 'dmy',
  currency: 'EUR',
});

const LEGACY_LOCALE = { de: 'de-DE', en: 'en-US' };

// Keeps preferences saved by earlier versions readable: they stored `numbers: 'de' | 'en'`.
export function normalizePrefs(raw) {
  const value = raw && typeof raw === 'object' ? raw : {};
  const locale = value.locale ?? LEGACY_LOCALE[value.numbers] ?? DEFAULT_PREFS.locale;
  return {
    lang: value.lang ?? DEFAULT_PREFS.lang,
    locale,
    dates: value.dates ?? DEFAULT_PREFS.dates,
    currency: value.currency ?? DEFAULT_PREFS.currency,
  };
}

// Returns { code, params } for the first invalid choice, or null. Used by the server and the settings form.
export function prefsError(raw) {
  if (!raw || typeof raw !== 'object') return { code: 'prefs.missing' };
  const checks = [
    ['lang', Object.hasOwn(LANGUAGES, raw.lang)],
    ['locale', NUMBER_LOCALES.includes(raw.locale)],
    ['dates', DATE_ORDERS.includes(raw.dates)],
    ['currency', CURRENCIES.includes(raw.currency)],
  ];
  const invalid = checks.find(([, ok]) => !ok);
  return invalid ? { code: 'prefs.invalid', params: { field: invalid[0] } } : null;
}
