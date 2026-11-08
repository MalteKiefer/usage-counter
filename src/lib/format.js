import { DEFAULT_PREFS } from './locale.js';

// Number, date and currency formats follow the user's preferences; the app shell sets them once per render.
let prefs = { locale: DEFAULT_PREFS.locale, dates: DEFAULT_PREFS.dates, currency: DEFAULT_PREFS.currency };

export function setFormatPrefs(next) {
  prefs = { locale: next.locale, dates: next.dates, currency: next.currency };
}

export const formatLocale = () => prefs.locale;

const formatters = new Map();
function cached(key, make) {
  if (!formatters.has(key)) formatters.set(key, make());
  return formatters.get(key);
}

export const fmt = (value, digits = 1) =>
  value == null || Number.isNaN(value)
    ? 'n/a'
    : cached(`n:${prefs.locale}:${digits}`, () =>
        new Intl.NumberFormat(prefs.locale, { maximumFractionDigits: digits }),
      ).format(value);

export const fmtMoney = (value) =>
  value == null || Number.isNaN(value)
    ? 'n/a'
    : cached(`m:${prefs.locale}:${prefs.currency}`, () =>
        new Intl.NumberFormat(prefs.locale, {
          style: 'currency',
          currency: prefs.currency,
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }),
      ).format(value);

// Units that ECMA-402 does not know get a fixed symbol. The others come from Intl, so they follow the locale.
const UNIT_SYMBOLS = { 'cubic-meter': 'm³', 'kilowatt-hour': 'kWh' };

// Short unit text of a unit (for example 'liter' or 'kilogram') in the current locale, like "L" or "kg".
export function unitText(unit, locale = prefs.locale) {
  if (UNIT_SYMBOLS[unit]) return UNIT_SYMBOLS[unit];
  const parts = cached(`u:${locale}:${unit}`, () =>
    new Intl.NumberFormat(locale, { style: 'unit', unit, unitDisplay: 'short' }).formatToParts(1),
  );
  return parts.find((part) => part.type === 'unit')?.value ?? unit;
}

// Separators of the current number format, read from the locale instead of a fixed table.
export function separators(locale = prefs.locale) {
  const parts = cached(`s:${locale}`, () => new Intl.NumberFormat(locale).formatToParts(12345.6));
  return {
    group: parts.find((part) => part.type === 'group')?.value ?? ',',
    decimal: parts.find((part) => part.type === 'decimal')?.value ?? '.',
  };
}

const pad = (n) => String(n).padStart(2, '0');
const SEPARATOR = { dmy: '.', ymd: '-', mdy: '/' };

// Joins the named parts in the chosen date order, for example 'dmy' gives 01.11.2026.
function joinDate(order, parts, keys = order.split('')) {
  return keys.map((key) => parts[key]).join(SEPARATOR[order]);
}

// Takes 'YYYY-MM-DDTHH:MM' from the server, so no time zone conversion is needed.
export function fmtDateTime(readAt) {
  const [date, time] = readAt.split('T');
  const [y, m, d] = date.split('-');
  return `${joinDate(prefs.dates, { d, m, y })} ${time}`;
}

// Day and month only, as used on chart axes. The German style keeps the trailing dot.
export const fmtShortDate = (date) => {
  const parts = { d: pad(date.getDate()), m: pad(date.getMonth() + 1) };
  if (prefs.dates === 'dmy') return `${joinDate('dmy', parts, ['d', 'm'])}.`;
  return joinDate(prefs.dates, parts, ['m', 'd']);
};

// Takes wall-clock ms (see wallMs in derive.js), so it reads UTC parts to avoid a time zone shift.
export function fmtWallDate(wallTime) {
  const d = new Date(wallTime);
  return joinDate(prefs.dates, {
    d: pad(d.getUTCDate()),
    m: pad(d.getUTCMonth() + 1),
    y: String(d.getUTCFullYear()),
  });
}

export const fmtMonth = (ym) => {
  const [year, month] = ym.split('-');
  const parts = { m: month, y: year.slice(2) };
  return joinDate(prefs.dates, parts, prefs.dates === 'ymd' ? ['y', 'm'] : ['m', 'y']);
};

// Weekday name for an index where 0 is Monday, in the current locale.
export function weekdayLabel(index, locale = prefs.locale) {
  const monday = Date.UTC(2024, 0, 1);
  return cached(`w:${locale}`, () => new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' })).format(
    new Date(monday + index * 86_400_000),
  );
}

export function nowLocalInput() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

// Reads a number typed in the current locale. A lone decimal sign of the other kind is read as decimal
// when it is a dot, so "816.613" stays 816.613 even where the dot is a thousands sign.
export function parseNumber(text) {
  const { group, decimal } = separators();
  let s = String(text).trim().replace(/[\s\u00a0\u202f']/g, '');
  if (s.includes(group) && s.includes(decimal)) {
    const lastDecimal = s.lastIndexOf(decimal);
    const lastGroup = s.lastIndexOf(group);
    s = lastDecimal > lastGroup
      ? s.split(group).join('').replace(decimal, '.')
      : s.split(decimal).join('').replace(group, '.');
  } else if (s.includes(decimal)) {
    s = s.replace(decimal, '.');
  } else if (s.includes(group)) {
    s = group === '.' ? s : s.split(group).join('');
  }
  return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : NaN;
}
