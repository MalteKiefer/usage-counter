import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loginFailureKey } from './login.js';

test('known failures map to their message keys', () => {
  assert.equal(loginFailureKey('?login=failed'), 'login.failed');
  assert.equal(loginFailureKey('?login=denied'), 'login.denied');
});

test('missing or inherited names map to nothing', () => {
  assert.equal(loginFailureKey(''), null);
  assert.equal(loginFailureKey('?other=1'), null);
  assert.equal(loginFailureKey('?login=constructor'), null);
  assert.equal(loginFailureKey('?login=__proto__'), null);
});
