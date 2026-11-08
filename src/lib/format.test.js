import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fmtDateTime, fmtMonth, fmtShortDate, fmtMoney, parseNumber, setFormatPrefs, unitText, weekdayLabel } from './format.js';

const german = { locale: 'de-DE', dates: 'dmy', currency: 'EUR' };
const english = { locale: 'en-US', dates: 'ymd', currency: 'USD' };

test('a lone dot stays decimal, so 816.613 is not 816613', () => {
  setFormatPrefs(german);
  assert.equal(parseNumber('816.613'), 816.613);
  setFormatPrefs(english);
  assert.equal(parseNumber('816.613'), 816.613);
});

test('German comma is decimal, dot is thousands', () => {
  setFormatPrefs(german);
  assert.equal(parseNumber('816,613'), 816.613);
  assert.equal(parseNumber('1.234,5'), 1234.5);
  assert.equal(parseNumber('2100,50'), 2100.5);
});

test('English comma is thousands, dot is decimal', () => {
  setFormatPrefs(english);
  assert.equal(parseNumber('1,234.5'), 1234.5);
});

test('a Swiss number format, with its own separators, reads apostrophes as thousands', () => {
  setFormatPrefs({ ...german, locale: 'de-CH' });
  assert.equal(parseNumber("1'234.5"), 1234.5);
});

test('invalid text gives NaN', () => {
  setFormatPrefs(german);
  assert.ok(Number.isNaN(parseNumber('12a')));
  assert.ok(Number.isNaN(parseNumber('')));
});

test('money uses the chosen currency and the number format', () => {
  setFormatPrefs(german);
  assert.equal(fmtMoney(12.5), '12,50\u00a0€');
  setFormatPrefs(english);
  assert.equal(fmtMoney(12.5), '$12.50');
});

test('dates follow the chosen order and separator', () => {
  setFormatPrefs(german);
  assert.equal(fmtDateTime('2026-11-08T05:15'), '08.11.2026 05:15');
  assert.equal(fmtShortDate(new Date(2026, 10, 8)), '08.11.');
  assert.equal(fmtMonth('2026-11'), '11.26');
  setFormatPrefs({ ...german, dates: 'mdy' });
  assert.equal(fmtDateTime('2026-11-08T05:15'), '11/08/2026 05:15');
  setFormatPrefs(english);
  assert.equal(fmtDateTime('2026-11-08T05:15'), '2026-11-08 05:15');
  assert.equal(fmtMonth('2026-11'), '26-11');
});

test('unit text comes from the locale, with fixed symbols where Intl has none', () => {
  assert.equal(unitText('liter', 'de-DE'), 'l');
  assert.equal(unitText('kilogram', 'en-US'), 'kg');
  assert.equal(unitText('kilowatt-hour', 'de-DE'), 'kWh');
  assert.equal(unitText('cubic-meter', 'en-US'), 'm³');
});

test('weekday labels start on Monday and follow the locale', () => {
  assert.equal(weekdayLabel(0, 'de-DE'), 'Mo');
  assert.equal(weekdayLabel(0, 'en-US'), 'Mon');
  assert.equal(weekdayLabel(6, 'en-US'), 'Sun');
});
