import crypto from 'node:crypto';
import express from 'express';
import rateLimit from 'express-rate-limit';
import * as client from 'openid-client';
import { db } from './db.js';
import { config } from './config.js';
import { normalizePrefs, prefsError } from '../src/lib/locale.js';

const { oidc } = config;
const COOKIE = 'usage_session';
// Ties the callback to the browser that started the sign-in (login CSRF).
const LOGIN_COOKIE = 'usage_login';
const DAY_MS = 24 * 60 * 60 * 1000;
const SESSION_MS = oidc.sessionDays * DAY_MS;
const LOGIN_TTL_MS = 10 * 60 * 1000;
const PICTURE_LIMIT_BYTES = 256 * 1024;
const PICTURE_TIMEOUT_MS = 5000;
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

const issuerOrigin = oidc.issuerUrl ? new URL(oidc.issuerUrl).origin : null;
const appOrigin = oidc.redirectUrl ? new URL(oidc.redirectUrl).origin : null;
let oidcConfig = null;

const stmt = {
  insertLogin: db.prepare('INSERT INTO login_states (state, nonce, verifier, created_at) VALUES (?, ?, ?, ?)'),
  takeLogin: db.prepare('DELETE FROM login_states WHERE state = ? RETURNING nonce, verifier, created_at'),
  purgeLogins: db.prepare('DELETE FROM login_states WHERE created_at < ?'),
  // A failed picture fetch keeps the picture stored at an earlier sign-in.
  upsertUser: db.prepare(`
    INSERT INTO users (issuer, sub, email, name, picture) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (issuer, sub) DO UPDATE SET email = excluded.email, name = excluded.name,
      picture = COALESCE(excluded.picture, users.picture)
    RETURNING id`),
  insertSession: db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)'),
  purgeSessions: db.prepare('DELETE FROM sessions WHERE expires_at <= ?'),
  // The picture is a large data URL, so it is read only for the session view, not on every API call.
  sessionUser: db.prepare(`
    SELECT u.id, u.email, u.name, u.prefs FROM sessions s
    JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?`),
  pictureOf: db.prepare('SELECT picture FROM users WHERE id = ?'),
  removeSession: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
  setPrefs: db.prepare('UPDATE users SET prefs = ? WHERE id = ?'),
};

const hash = (value) => crypto.createHash('sha256').update(value).digest('base64url');

function readCookie(req, name) {
  const pair = (req.get('Cookie') ?? '').split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return pair ? pair.slice(name.length + 1) : null;
}

function setCookie(name, value, path, maxAgeSeconds) {
  return [
    `${name}=${value}`,
    `Path=${path}`,
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
    ...(oidc.cookieSecure ? ['Secure'] : []),
  ].join('; ');
}

// Discovery runs once at start-up, so a wrong issuer stops the server instead of failing every sign-in.
export async function initAuth() {
  if (!oidc.enabled) return;
  const isHttp = new URL(oidc.issuerUrl).protocol === 'http:';
  oidcConfig = await client.discovery(new URL(oidc.issuerUrl), oidc.clientId, undefined, client.ClientSecretBasic(oidc.clientSecret), {
    execute: isHttp ? [client.allowInsecureRequests] : undefined,
  });
}

// Only API and auth paths read the session; static files never need it.
export function loadUser(req, _res, next) {
  const token = readCookie(req, COOKIE);
  req.user = (token && stmt.sessionUser.get(hash(token), Date.now())) || null;
  next();
}

export function requireLogin(req, res, next) {
  if (!oidc.enabled || req.user) return next();
  res.status(401).json({ error: 'auth.required' });
}

// Cookies are SameSite=Lax, and this check also refuses cross-site writes from other clients.
export function checkOrigin(req, res, next) {
  if (!oidc.enabled || SAFE_METHODS.has(req.method)) return next();
  if (req.get('Origin') !== appOrigin) return res.status(403).json({ error: 'origin.forbidden' });
  next();
}

// Stored preferences that no longer pass validation fall back to the defaults, so the client never gets them.
function storedPrefs(json) {
  const prefs = normalizePrefs(JSON.parse(json));
  return prefsError(prefs) ? normalizePrefs({}) : prefs;
}

export function sessionView(user) {
  const auth = { enabled: oidc.enabled };
  if (!user) return { auth, user: null };
  return {
    auth,
    user: {
      name: user.name,
      email: user.email,
      picture: stmt.pictureOf.get(user.id).picture,
      prefs: storedPrefs(user.prefs),
    },
  };
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

// Each sign-in starts and ends with these routes. Limiting them slows down guessing of states and codes.
const signInLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
});

authRouter.get('/auth/login', signInLimit, async (_req, res) => {
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
  res.set({
    'Cache-Control': 'no-store',
    'Set-Cookie': setCookie(LOGIN_COOKIE, state, '/auth', LOGIN_TTL_MS / 1000),
  }).redirect(url.href);
});

authRouter.get('/auth/callback', signInLimit, async (req, res) => {
  const current = new URL(req.originalUrl, oidc.redirectUrl);
  const state = current.searchParams.get('state');
  // Checked before the state is used up, so a forged callback cannot consume a sign-in in progress.
  if (!state || readCookie(req, LOGIN_COOKIE) !== state) return res.redirect('/?login=failed');
  const login = stmt.takeLogin.get(state);
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
  // A new sign-in replaces the session of this browser, so an older token stops working.
  const previous = readCookie(req, COOKIE);
  if (previous) stmt.removeSession.run(hash(previous));
  stmt.purgeSessions.run(Date.now());
  stmt.insertSession.run(hash(token), user.id, Date.now() + SESSION_MS);
  res.set('Set-Cookie', [
    setCookie(COOKIE, token, '/', SESSION_MS / 1000),
    setCookie(LOGIN_COOKIE, '', '/auth', 0),
  ]).redirect('/');
});

authRouter.post('/auth/logout', (req, res) => {
  const token = readCookie(req, COOKIE);
  if (token) stmt.removeSession.run(hash(token));
  res.set('Set-Cookie', setCookie(COOKIE, '', '/', 0)).status(204).end();
});

authRouter.put('/api/me/preferences', requireLogin, (req, res) => {
  const error = prefsError(req.body);
  if (error) return res.status(422).json({ error: error.code, params: error.params });
  const prefs = normalizePrefs(req.body);
  stmt.setPrefs.run(JSON.stringify(prefs), req.user.id);
  res.json(prefs);
});
