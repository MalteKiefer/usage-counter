import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from './config.js';

test('defaults are safe for a local start', () => {
  const c = loadConfig({});
  assert.equal(c.port, 3001);
  assert.equal(c.host, '127.0.0.1');
  assert.deepEqual(c.allowedHosts, []);
  assert.equal(c.backupLimitMb, 25);
  assert.equal(c.oidc.enabled, false);
});

test('rejects invalid numbers and booleans', () => {
  assert.throws(() => loadConfig({ PORT: '70000' }), /PORT/);
  assert.throws(() => loadConfig({ BACKUP_LIMIT_MB: 'viel' }), /BACKUP_LIMIT_MB/);
  assert.throws(() => loadConfig({ OIDC_ENABLED: 'yes' }), /OIDC_ENABLED/);
});

test('ALLOWED_HOSTS is a trimmed list', () => {
  assert.deepEqual(loadConfig({ ALLOWED_HOSTS: ' nas.lan , , box.local ' }).allowedHosts, ['nas.lan', 'box.local']);
});

test('enabling OIDC fails until login exists', () => {
  assert.throws(() => loadConfig({ OIDC_ENABLED: 'true' }), /noch nicht implementiert/);
});

test('prepared OIDC URLs must be https', () => {
  assert.throws(() => loadConfig({ OIDC_ISSUER_URL: 'http://id.example.org', OIDC_CLIENT_ID: 'x' }), /https/);
  assert.doesNotThrow(() => loadConfig({ OIDC_ISSUER_URL: 'https://id.example.org', OIDC_CLIENT_ID: 'x' }));
});

test('secret can be read from a file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-'));
  const file = path.join(dir, 'secret');
  fs.writeFileSync(file, 'geheim\n');
  try {
    assert.equal(loadConfig({ OIDC_CLIENT_SECRET_FILE: file }).oidc.clientSecret, 'geheim');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
