import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DICTIONARIES, translator } from './i18n.js';

test('every language has the same keys as German', () => {
  const german = Object.keys(DICTIONARIES.de).sort();
  for (const [lang, dict] of Object.entries(DICTIONARIES)) {
    assert.deepEqual(Object.keys(dict).sort(), german, `keys of ${lang}`);
  }
});

test('a missing key falls back along the language chain and then to the key', () => {
  const t = translator('de');
  assert.equal(t('app.title'), DICTIONARIES.de['app.title']);
  assert.equal(t('no.such.key'), 'no.such.key');
});

test('unknown languages use the default language', () => {
  assert.equal(translator('toString')('unit.day'), DICTIONARIES.de['unit.day']);
});
