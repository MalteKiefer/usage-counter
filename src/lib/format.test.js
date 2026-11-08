import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseNumber, setFormatPrefs } from './format.js';

test('a lone dot stays decimal, so 816.613 is not 816613', () => {
  setFormatPrefs({ numbers: 'de', dates: 'dmy' });
  assert.equal(parseNumber('816.613'), 816.613);
});

test('German comma is decimal, dot is thousands', () => {
  setFormatPrefs({ numbers: 'de', dates: 'dmy' });
  assert.equal(parseNumber('816,613'), 816.613);
  assert.equal(parseNumber('1.234,5'), 1234.5);
  assert.equal(parseNumber('2100,50'), 2100.5);
});

test('English comma is thousands, dot is decimal', () => {
  setFormatPrefs({ numbers: 'en', dates: 'ymd' });
  assert.equal(parseNumber('1,234.5'), 1234.5);
  assert.equal(parseNumber('816.613'), 816.613);
});

test('invalid text gives NaN', () => {
  assert.ok(Number.isNaN(parseNumber('12a')));
  assert.ok(Number.isNaN(parseNumber('')));
});
