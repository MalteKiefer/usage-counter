import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

// A mock Pocket-ID issuer: discovery, JWKS, authorize (auto-approves), token with PKCE check.
const CLIENT_ID = 'usage-counter';
const CLIENT_SECRET = 'test-secret';
const APP_ORIGIN = 'http://127.0.0.1:3999';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-auth-'));
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'test', alg: 'RS256', use: 'sig' };
const codes = new Map();
let mockUser = { email: 'anna@example.org', picture: null };
let issuer;
let issuerServer;
let server;
let base;

const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');

function signIdToken(payload) {
  const input = `${b64({ alg: 'RS256', kid: 'test', typ: 'JWT' })}.${b64(payload)}`;
  return `${input}.${crypto.sign('sha256', Buffer.from(input), privateKey).toString('base64url')}`;
}

function send(res, status, body, type = 'application/json') {
  res.writeHead(status, { 'Content-Type': type });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => resolve(data));
  });
}

async function handleIssuer(req, res) {
  const url = new URL(req.url, issuer);
  if (url.pathname === '/.well-known/openid-configuration') {
    return send(res, 200, {
      issuer,
      authorization_endpoint: `${issuer}/authorize`,
      token_endpoint: `${issuer}/token`,
      jwks_uri: `${issuer}/jwks`,
      response_types_supported: ['code'],
      subject_types_supported: ['public'],
      id_token_signing_alg_values_supported: ['RS256'],
      code_challenge_methods_supported: ['S256'],
    });
  }
  if (url.pathname === '/jwks') return send(res, 200, { keys: [jwk] });
  if (url.pathname === '/pic.png') return send(res, 200, Buffer.from('iVBORw0KGgo=', 'base64'), 'image/png');
  if (url.pathname === '/authorize') {
    const code = crypto.randomBytes(16).toString('base64url');
    codes.set(code, {
      nonce: url.searchParams.get('nonce'),
      challenge: url.searchParams.get('code_challenge'),
      redirectUri: url.searchParams.get('redirect_uri'),
    });
    const back = new URL(url.searchParams.get('redirect_uri'));
    back.searchParams.set('code', code);
    back.searchParams.set('state', url.searchParams.get('state'));
    res.writeHead(302, { Location: back.href });
    return res.end();
  }
  if (url.pathname === '/token' && req.method === 'POST') {
    const form = new URLSearchParams(await readBody(req));
    const grant = codes.get(form.get('code'));
    codes.delete(form.get('code'));
    const pkceOk = grant && crypto.createHash('sha256').update(form.get('code_verifier') ?? '').digest('base64url') === grant.challenge;
    // RFC 6749 form-encodes client id and secret before the Basic encoding.
    const [id, secret] = Buffer.from((req.headers.authorization ?? '').replace('Basic ', ''), 'base64')
      .toString()
      .split(':')
      .map(decodeURIComponent);
    if (id !== CLIENT_ID || secret !== CLIENT_SECRET || !grant || !pkceOk) {
      return send(res, 400, { error: 'invalid_grant' });
    }
    const now = Math.floor(Date.now() / 1000);
    const idToken = signIdToken({
      iss: issuer,
      sub: 'sub-anna',
      aud: CLIENT_ID,
      iat: now,
      exp: now + 300,
      nonce: grant.nonce,
      email: mockUser.email,
      email_verified: mockUser.emailVerified ?? true,
      name: 'Anna Beispiel',
      picture: mockUser.picture,
    });
    return send(res, 200, { access_token: 'access', token_type: 'Bearer', expires_in: 300, id_token: idToken });
  }
  send(res, 404, { error: 'not_found' });
}

before(() => new Promise((resolve) => {
  issuerServer = http.createServer((req, res) => {
    handleIssuer(req, res).catch((err) => send(res, 500, { error: err.message }));
  });
  issuerServer.listen(0, '127.0.0.1', async () => {
    issuer = `http://127.0.0.1:${issuerServer.address().port}`;
    process.env.DB_PATH = path.join(dir, 'auth.db');
    process.env.OIDC_ENABLED = 'true';
    process.env.OIDC_ISSUER_URL = issuer;
    process.env.OIDC_CLIENT_ID = CLIENT_ID;
    process.env.OIDC_CLIENT_SECRET = CLIENT_SECRET;
    process.env.OIDC_REDIRECT_URL = `${APP_ORIGIN}/auth/callback`;
    process.env.OIDC_ALLOWED_EMAILS = 'anna@example.org';
    const { app } = await import('./app.js');
    const { initAuth } = await import('./auth.js');
    await initAuth();
    server = app.listen(0, '127.0.0.1', () => {
      base = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
}));

after(() => new Promise((resolve) => {
  server.close(() => {
    issuerServer.close(() => {
      fs.rmSync(dir, { recursive: true, force: true });
      resolve();
    });
  });
}));

const call = (method, url, { cookie, body, origin = APP_ORIGIN } = {}) =>
  fetch(`${base}${url}`, {
    method,
    redirect: 'manual',
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...(origin ? { Origin: origin } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

// Runs the browser steps: login redirect, approval at the issuer, callback into the app.
async function signIn(email = 'anna@example.org') {
  mockUser = { email, picture: `${issuer}/pic.png` };
  const login = await call('GET', '/auth/login');
  const approved = await fetch(login.headers.get('location'), { redirect: 'manual' });
  const callback = approved.headers.get('location');
  return {
    res: await fetch(callback.replace(APP_ORIGIN, base), { redirect: 'manual' }),
    callback,
  };
}

const sessionCookieOf = (res) => {
  const header = res.headers.get('set-cookie') ?? '';
  const match = header.match(/usage_session=([^;]+)/);
  return match ? `usage_session=${match[1]}` : null;
};

test('API answers 401 without login', async () => {
  assert.equal((await call('GET', '/api/objects', { origin: null })).status, 401);
});

test('session endpoint is open and reports no user', async () => {
  const body = await (await call('GET', '/api/session', { origin: null })).json();
  assert.deepEqual(body, { auth: { enabled: true }, user: null });
});

test('login redirects to the issuer with PKCE and state', async () => {
  const res = await call('GET', '/auth/login');
  assert.equal(res.status, 302);
  const location = new URL(res.headers.get('location'));
  assert.equal(location.origin, issuer);
  assert.equal(location.searchParams.get('code_challenge_method'), 'S256');
  assert.ok(location.searchParams.get('state'));
  assert.ok(location.searchParams.get('nonce'));
});

test('sign-in sets an HttpOnly session cookie and loads the user', async () => {
  const { res } = await signIn();
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/');
  const header = res.headers.get('set-cookie');
  assert.match(header, /HttpOnly/);
  assert.match(header, /SameSite=Lax/);
  const cookie = sessionCookieOf(res);
  const session = await (await call('GET', '/api/session', { cookie, origin: null })).json();
  assert.equal(session.user.email, 'anna@example.org');
  assert.equal(session.user.name, 'Anna Beispiel');
  assert.match(session.user.picture, /^data:image\/png;base64,/);
  assert.equal((await call('GET', '/api/objects', { cookie, origin: null })).status, 200);
});

test('session token is stored only as a hash', async () => {
  const { res } = await signIn();
  const token = sessionCookieOf(res).split('=')[1];
  const { db } = await import('./db.js');
  const rows = db.prepare('SELECT token_hash FROM sessions').all().map((r) => r.token_hash);
  assert.ok(rows.length > 0);
  assert.equal(rows.includes(token), false);
});

test('a login state works only once', async () => {
  const { callback } = await signIn();
  const replay = await fetch(callback.replace(APP_ORIGIN, base), { redirect: 'manual' });
  assert.equal(replay.headers.get('location'), '/?login=failed');
});

test('mail address not on the allow list gets no session', async () => {
  const { res } = await signIn('eve@example.org');
  assert.equal(res.headers.get('location'), '/?login=denied');
  assert.equal(sessionCookieOf(res), null);
});

test('unverified mail address gets no session', async () => {
  mockUser = { email: 'anna@example.org', picture: null, emailVerified: false };
  const login = await call('GET', '/auth/login');
  const approved = await fetch(login.headers.get('location'), { redirect: 'manual' });
  const res = await fetch(approved.headers.get('location').replace(APP_ORIGIN, base), { redirect: 'manual' });
  assert.equal(res.headers.get('location'), '/?login=denied');
  assert.equal(sessionCookieOf(res), null);
  mockUser = { email: 'anna@example.org', picture: null };
});

test('picture from another host is not fetched', async () => {
  mockUser = { email: 'anna@example.org', picture: 'http://127.0.0.1:1/evil.png' };
  const login = await call('GET', '/auth/login');
  const approved = await fetch(login.headers.get('location'), { redirect: 'manual' });
  const res = await fetch(approved.headers.get('location').replace(APP_ORIGIN, base), { redirect: 'manual' });
  const cookie = sessionCookieOf(res);
  const session = await (await call('GET', '/api/session', { cookie, origin: null })).json();
  assert.equal(session.user.picture, null);
});

test('writes need the app origin', async () => {
  const { res } = await signIn();
  const cookie = sessionCookieOf(res);
  const body = { name: 'Haus' };
  assert.equal((await call('POST', '/api/objects', { cookie, body, origin: 'https://evil.test' })).status, 403);
  assert.equal((await call('POST', '/api/objects', { cookie, body, origin: null })).status, 403);
  assert.equal((await call('POST', '/api/objects', { cookie, body })).status, 201);
});

test('preferences are stored per account and validated', async () => {
  const { res } = await signIn();
  const cookie = sessionCookieOf(res);
  const bad = await call('PUT', '/api/me/preferences', { cookie, body: { lang: 'fr', numbers: 'de', dates: 'dmy' } });
  assert.equal(bad.status, 422);
  const ok = await call('PUT', '/api/me/preferences', { cookie, body: { lang: 'en', numbers: 'en', dates: 'ymd' } });
  assert.equal(ok.status, 200);
  const session = await (await call('GET', '/api/session', { cookie, origin: null })).json();
  assert.deepEqual(session.user.prefs, { lang: 'en', numbers: 'en', dates: 'ymd' });
});

test('logout ends the session', async () => {
  const { res } = await signIn();
  const cookie = sessionCookieOf(res);
  assert.equal((await call('POST', '/auth/logout', { cookie })).status, 204);
  assert.equal((await call('GET', '/api/objects', { cookie, origin: null })).status, 401);
});
