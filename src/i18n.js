import { createContext, useContext } from 'react';
import de from './i18n/de.js';
import en from './i18n/en.js';
import { DEFAULT_PREFS, LANGUAGES } from './lib/locale.js';

export const DICTIONARIES = { de, en };

// Returns t(key, vars). A missing key falls back along the language's chain, then to the key itself.
export function translator(lang) {
  const chain = [];
  let current = Object.hasOwn(DICTIONARIES, lang) ? lang : DEFAULT_PREFS.lang;
  while (current) {
    chain.push(DICTIONARIES[current]);
    current = LANGUAGES[current].fallback;
  }
  return (key, vars = {}) => {
    const template = chain.find((dict) => key in dict)?.[key] ?? key;
    return template.replace(/\{(\w+)\}/g, (match, name) => (name in vars ? String(vars[name]) : match));
  };
}

export const I18nContext = createContext(translator(DEFAULT_PREFS.lang));
export const useT = () => useContext(I18nContext);
