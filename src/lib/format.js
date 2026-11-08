// Number and date formats follow the user's preferences; set once per render by the app shell.
let prefs = { numbers: 'de', dates: 'dmy' };

export function setFormatPrefs(next) {
  prefs = { numbers: next.numbers, dates: next.dates };
}

const formatters = new Map();
function cached(key, make) {
  if (!formatters.has(key)) formatters.set(key, make());
  return formatters.get(key);
}

const numberLocale = () => (prefs.numbers === 'en' ? 'en-US' : 'de-DE');

export const fmt = (value, digits = 1) =>
  value == null || Number.isNaN(value)
    ? 'n/a'
    : cached(`n:${numberLocale()}:${digits}`, () =>
        new Intl.NumberFormat(numberLocale(), { maximumFractionDigits: digits }),
      ).format(value);

export const fmtMoney = (value) =>
  `${cached(`m:${numberLocale()}`, () =>
    new Intl.NumberFormat(numberLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  ).format(value)} €`;

const pad = (n) => String(n).padStart(2, '0');

// Takes 'YYYY-MM-DDTHH:MM' from the server, so no time zone conversion is needed.
export function fmtDateTime(readAt) {
  const [date, time] = readAt.split('T');
  const [y, m, d] = date.split('-');
  return `${prefs.dates === 'ymd' ? `${y}-${m}-${d}` : `${d}.${m}.${y}`} ${time}`;
}

export const fmtShortDate = (date) => {
  const day = pad(date.getDate());
  const month = pad(date.getMonth() + 1);
  return prefs.dates === 'ymd' ? `${month}-${day}` : `${day}.${month}.`;
};

// Takes wall-clock ms (see wallMs in derive.js), so it reads UTC parts to avoid a time zone shift.
export function fmtWallDate(wallTime) {
  const d = new Date(wallTime);
  const y = d.getUTCFullYear();
  const m = pad(d.getUTCMonth() + 1);
  const day = pad(d.getUTCDate());
  return prefs.dates === 'ymd' ? `${y}-${m}-${day}` : `${day}.${m}.${y}`;
}

export const fmtMonth = (ym) => {
  const [year, month] = ym.split('-');
  return prefs.dates === 'ymd' ? `${year.slice(2)}-${month}` : `${month}.${year.slice(2)}`;
};

export function nowLocalInput() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

// Reads a number typed in the user's format. A comma is the decimal sign in German and a
// thousands sign in English. A lone dot is always read as decimal, so "816.613" stays 816.613.
export function parseNumber(text) {
  let s = String(text).trim().replace(/\s/g, '');
  if (s.includes(',') && s.includes('.')) {
    const decimal = s.lastIndexOf(',') > s.lastIndexOf('.') ? ',' : '.';
    s = decimal === ',' ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (s.includes(',')) {
    s = prefs.numbers === 'de' ? s.replace(',', '.') : s.replace(/,/g, '');
  }
  return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : NaN;
}
