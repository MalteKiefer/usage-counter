import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// A secret may come from the variable itself or from a file named in NAME_FILE (Docker secrets).
function secret(env, name) {
  const file = env[`${name}_FILE`];
  if (file) return readFileSync(file, 'utf8').trim();
  return env[name] ?? '';
}

function integer(env, name, fallback, min, max) {
  if (env[name] === undefined || env[name] === '') return fallback;
  const value = Number(env[name]);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be a whole number from ${min} to ${max}`);
  }
  return value;
}

function boolean(env, name, fallback) {
  const value = env[name];
  if (value === undefined || value === '') return fallback;
  if (['true', '1'].includes(value)) return true;
  if (['false', '0'].includes(value)) return false;
  throw new Error(`${name} must be true or false`);
}

function list(env, name) {
  return (env[name] ?? '').split(',').map((item) => item.trim()).filter(Boolean);
}

function httpsUrl(value) {
  try {
    const url = new URL(value);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    return url.protocol === 'https:' || (url.protocol === 'http:' && local);
  } catch {
    return false;
  }
}

// Reads all settings in one place and fails at start-up on invalid values.
export function loadConfig(env = process.env) {
  const oidc = {
    enabled: boolean(env, 'OIDC_ENABLED', false),
    issuerUrl: env.OIDC_ISSUER_URL ?? '',
    clientId: env.OIDC_CLIENT_ID ?? '',
    clientSecret: secret(env, 'OIDC_CLIENT_SECRET'),
    redirectUrl: env.OIDC_REDIRECT_URL ?? '',
    scopes: env.OIDC_SCOPES ?? 'openid profile email',
    allowedEmails: list(env, 'OIDC_ALLOWED_EMAILS').map((email) => email.toLowerCase()),
    sessionDays: integer(env, 'SESSION_DAYS', 7, 1, 30),
  };

  // Only the listed mail addresses may sign in: a Pocket-ID instance can hold more users than this app should serve.
  if (oidc.enabled) {
    const missing = [
      ['OIDC_ISSUER_URL', oidc.issuerUrl],
      ['OIDC_CLIENT_ID', oidc.clientId],
      ['OIDC_CLIENT_SECRET (or OIDC_CLIENT_SECRET_FILE)', oidc.clientSecret],
      ['OIDC_REDIRECT_URL', oidc.redirectUrl],
      ['OIDC_ALLOWED_EMAILS', oidc.allowedEmails.length],
    ].filter(([, value]) => !value).map(([name]) => name);
    if (missing.length) throw new Error(`OIDC_ENABLED=true, but missing: ${missing.join(', ')}`);
  }
  if (oidc.issuerUrl && !httpsUrl(oidc.issuerUrl)) throw new Error('OIDC_ISSUER_URL must be https (or http on localhost)');
  if (oidc.redirectUrl && !httpsUrl(oidc.redirectUrl)) throw new Error('OIDC_REDIRECT_URL must be https (or http on localhost)');
  oidc.cookieSecure = oidc.redirectUrl.startsWith('https://');

  return {
    nodeEnv: env.NODE_ENV ?? 'development',
    port: integer(env, 'PORT', 3001, 1, 65535),
    host: env.HOST ?? '127.0.0.1',
    dbPath: env.DB_PATH ?? path.join(root, 'usage.db'),
    allowedHosts: list(env, 'ALLOWED_HOSTS'),
    backupLimitMb: integer(env, 'BACKUP_LIMIT_MB', 25, 1, 100),
    oidc,
  };
}

export const config = loadConfig();
