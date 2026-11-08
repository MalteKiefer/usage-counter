import crypto from 'node:crypto';
import express from 'express';
import * as client from 'openid-client';
import { db } from './db.js';
import { config } from './config.js';

// Sign-in with Pocket-ID (OpenID Connect). Only used when OIDC_ENABLED=true.
const { oidc } = config;
const COOKIE = 'usage_session';
const DAY_MS = 24 * 60 * 60 * 1000;
const LOGIN_TTL_MS = 10 * 60 * 1000;
const PICTURE_LIMIT_BYTES = 256 * 1024;
const PICTURE_TIMEOUT_MS = 5000;
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const PREFERENCE_VALUES = {
  lang: ['de', 'en'],
  numbers: ['de', 'en'],
  dates: ['dmy', 'ymd'],
};
const DEFAULT_PREFS = { lang: 'de', numbers: 'de', dates: 'dmy' };

const issuerOrigin = oidc.issuerUrl ? new URL(oidc.issuerUrl).origin : null;
const appOrigin = oidc.redirectUrl ? new URL(oidc.redirectUrl).origin : null;
let oidcConfig = null;

const stmt = {
  insertLogin: db.prepare('INSERT INTO login_states (state, nonce, verifier, created_at) VALUES (?, ?, ?, ?)'),
  takeLogin: db.prepare('DELETE FROM login_states WHERE state = ? RETURNING nonce, verifier, created_at'),
  purgeLogins: db.prepare('DELETE FROM login_states WHERE created_at < ?'),
  upsertUser: db.prepare(`
    INSERT INTO users (issuer, sub, email, name, picture) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (issuer, sub) DO UPDATE SET email = excluded.email, name = excluded.name, picture = excluded.picture
    RETURNING id`),
  insertSession: db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)'),
  sessionUser: db.prepare(`
    SELECT u.id, u.email, u.name, u.picture, u.prefs FROM sessions s
    JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?`),
  removeSession: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
  setPrefs: db.prepare('UPDATE users SET prefs = ? WHERE id = ?'),
};

const hash = (value) => crypto.createHash('sha256').update(value).digest('base64url');

function readCookie(req, name) {
  const pair = (req.get('Cookie') ?? '').split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return pair ? pair.slice(name.length + 1) : null;
}

function sessionCookie(value, maxAgeSeconds) {
  return [
    `${COOKIE}=${value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
    ...(oidc.cookieSecure ? ['Secure'] : []),
  ].join('; ');
}

// Connects to Pocket-ID once at start-up; a wrong issuer stops the server with the error message.
export async function initAuth() {
  if (!oidc.enabled) return;
  const isHttp = new URL(oidc.issuerUrl).protocol === 'http:';
  oidcConfig = await client.discovery(new URL(oidc.issuerUrl), oidc.clientId, undefined, client.ClientSecretBasic(oidc.clientSecret), {
    execute: isHttp ? [client.allowInsecureRequests] : undefined,
  });
}

// Reads the session cookie on every request. Without OIDC there is no user.
export function loadUser(req, _res, next) {
  const token = readCookie(req, COOKIE);
  req.user = (token && stmt.sessionUser.get(hash(token), Date.now())) || null;
  next();
}

export function requireLogin(req, res, next) {
  if (!oidc.enabled || req.user) return next();
  res.status(401).json({ error: 'Anmeldung erforderlich' });
}

// Cookies are SameSite=Lax, and this check also refuses cross-site writes from other clients.
export function checkOrigin(req, res, next) {
  if (!oidc.enabled || SAFE_METHODS.has(req.method)) return next();
  if (req.get('Origin') !== appOrigin) return res.status(403).json({ error: 'Herkunft nicht erlaubt' });
  next();
}

export function sessionView(user) {
  return {
    auth: { enabled: oidc.enabled },
    user: user ? { name: user.name, email: user.email, picture: user.picture, prefs: { ...DEFAULT_PREFS, ...JSON.parse(user.prefs) } } : null,
  };
}

export function preferencesError(body) {
  if (!body || typeof body !== 'object') return 'Einstellungen fehlen';
  const invalid = Object.keys(PREFERENCE_VALUES).find((key) => !PREFERENCE_VALUES[key].includes(body[key]));
  return invalid ? `Ungültiger Wert für ${invalid}` : null;
}

// The picture comes from the issuer only, with a size limit, so a user cannot point the server at other hosts.
async function fetchPicture(url) {
  if (typeof url !== 'string') return null;
  let target;
  try {
    target = new URL(url);
  } catch {
    return null;
  }
  if (target.origin !== issuerOrigin) return null;
  try {
    const res = await fetch(target, { redirect: 'error', signal: AbortSignal.timeout(PICTURE_TIMEOUT_MS) });
    const type = (res.headers.get('content-type') ?? '').split(';')[0];
    if (!res.ok || !type.startsWith('image/')) return null;
    const chunks = [];
    let size = 0;
    for await (const chunk of res.body) {
      size += chunk.length;
      if (size > PICTURE_LIMIT_BYTES) return null;
      chunks.push(chunk);
    }
    return `data:${type};base64,${Buffer.concat(chunks).toString('base64')}`;
  } catch (err) {
    console.warn('Profilbild nicht geladen:', err.message);
    return null;
  }
}

export const authRouter = express.Router();

authRouter.get('/auth/login', async (_req, res) => {
  stmt.purgeLogins.run(Date.now() - LOGIN_TTL_MS);
  const state = client.randomState();
  const nonce = client.randomNonce();
  const verifier = client.randomPKCECodeVerifier();
  stmt.insertLogin.run(state, nonce, verifier, Date.now());
  const url = client.buildAuthorizationUrl(oidcConfig, {
    redirect_uri: oidc.redirectUrl,
    response_type: 'code',
    scope: oidc.scopes,
    state,
    nonce,
    code_challenge: await client.calculatePKCECodeChallenge(verifier),
    code_challenge_method: 'S256',
  });
  res.set('Cache-Control', 'no-store').redirect(url.href);
});

authRouter.get('/auth/callback', async (req, res) => {
  const current = new URL(req.originalUrl, oidc.redirectUrl);
  const state = current.searchParams.get('state');
  const login = state ? stmt.takeLogin.get(state) : undefined;
  if (!login || login.created_at < Date.now() - LOGIN_TTL_MS) return res.redirect('/?login=failed');

  let claims;
  try {
    const tokens = await client.authorizationCodeGrant(oidcConfig, current, {
      pkceCodeVerifier: login.verifier,
      expectedState: state,
      expectedNonce: login.nonce,
    });
    claims = tokens.claims();
  } catch (err) {
    console.warn('Anmeldung abgelehnt:', err.message);
    return res.redirect('/?login=failed');
  }

  // An unverified address can be typed in by anyone, so only a verified one counts for the allow list.
  const email = typeof claims.email === 'string' ? claims.email.toLowerCase() : '';
  if (claims.email_verified !== true || !oidc.allowedEmails.includes(email)) {
    return res.redirect('/?login=denied');
  }

  const name = String(claims.name ?? claims.preferred_username ?? email).trim().slice(0, 100);
  const picture = await fetchPicture(claims.picture);
  const user = stmt.upsertUser.get(claims.iss, claims.sub, email, name || email, picture);
  const token = crypto.randomBytes(32).toString('base64url');
  stmt.insertSession.run(hash(token), user.id, Date.now() + oidc.sessionDays * DAY_MS);
  res.set('Set-Cookie', sessionCookie(token, oidc.sessionDays * 24 * 60 * 60)).redirect('/');
});

authRouter.post('/auth/logout', (req, res) => {
  const token = readCookie(req, COOKIE);
  if (token) stmt.removeSession.run(hash(token));
  res.set('Set-Cookie', sessionCookie('', 0)).status(204).end();
});

authRouter.put('/api/me/preferences', requireLogin, (req, res) => {
  const error = preferencesError(req.body);
  if (error) return res.status(422).json({ error });
  const prefs = Object.fromEntries(Object.keys(PREFERENCE_VALUES).map((key) => [key, req.body[key]]));
  stmt.setPrefs.run(JSON.stringify(prefs), req.user.id);
  res.json(prefs);
});
