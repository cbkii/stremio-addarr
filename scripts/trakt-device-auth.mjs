#!/usr/bin/env node
import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import readline from 'node:readline/promises';
import {
  TraktAuthError,
  pollTraktDeviceToken,
  refreshTraktToken,
  requestTraktDeviceCode,
  verifyTraktAccessToken
} from '../dist/src/services/trakt-auth.js';

function parseArgs(argv) {
  const result = {
    envFile: '/opt/stremio-addarr/.env',
    appVersion: 'unknown'
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--env') result.envFile = argv[++index];
    else if (arg === '--version') result.appVersion = argv[++index];
    else if (arg === '--help' || arg === '-h') {
      console.log('Usage: node scripts/trakt-device-auth.mjs [--env /opt/stremio-addarr/.env] [--version X.Y.Z]');
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return result;
}

function decodeEnvValue(raw) {
  const value = raw.trim();
  if (value.startsWith('"') && value.endsWith('"')) {
    try { return JSON.parse(value); } catch { return value.slice(1, -1); }
  }
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1);
  return value.replace(/\s+#.*$/, '').trim();
}

function parseEnv(content) {
  const result = new Map();
  for (const line of content.split(/\r?\n/)) {
    if (/^\s*#/.test(line)) continue;
    const match = /^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (match) result.set(match[1], decodeEnvValue(match[2]));
  }
  return result;
}

function encodeEnvValue(value) {
  if (/^[A-Za-z0-9_./,:@+\-]*$/.test(value)) return value;
  return JSON.stringify(value);
}

function updateEnvContent(content, updates) {
  const remaining = new Map(updates);
  const lines = content ? content.split(/\r?\n/) : [];
  const updated = lines.map((line) => {
    const match = /^(\s*(?:export\s+)?)([A-Z][A-Z0-9_]*)\s*=/.exec(line);
    if (!match || !updates.has(match[2])) return line;
    const value = updates.get(match[2]) ?? '';
    remaining.delete(match[2]);
    return `${match[1]}${match[2]}=${encodeEnvValue(value)}`;
  });
  if (remaining.size > 0) {
    if (updated.length && updated.at(-1) !== '') updated.push('');
    updated.push('# Managed by Trakt device authentication');
    for (const [key, value] of remaining) updated.push(`${key}=${encodeEnvValue(value)}`);
  }
  while (updated.length > 1 && updated.at(-1) === '' && updated.at(-2) === '') updated.pop();
  return `${updated.join('\n')}\n`;
}

async function readEnvFile(envFile) {
  try {
    const raw = await fs.readFile(envFile, 'utf8');
    return { raw, values: parseEnv(raw) };
  } catch (error) {
    if (error?.code === 'ENOENT') throw new Error(`Environment file not found: ${envFile}`);
    throw error;
  }
}

async function atomicWriteEnv(envFile, raw) {
  const temporary = `${envFile}.tmp-trakt-${process.pid}`;
  const backup = `${envFile}.backup-before-trakt-auth`;
  await fs.copyFile(envFile, backup);
  await fs.chmod(backup, 0o600);
  try {
    const handle = await fs.open(temporary, 'w', 0o600);
    try {
      await handle.writeFile(raw, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.rename(temporary, envFile);
    await fs.chmod(envFile, 0o600);
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => undefined);
  }
}

function mask(value) {
  if (!value) return 'not configured';
  if (value.length <= 8) return `${value.slice(0, 2)}…${value.slice(-2)}`;
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

function describeError(error) {
  if (error instanceof TraktAuthError) {
    const detail = error.code || error.responseText;
    return `${error.message}${error.status ? ` (HTTP ${error.status})` : ''}${detail ? `: ${detail}` : ''}`;
  }
  return error instanceof Error ? error.message : String(error);
}

async function promptRequired(rl, label, current, options = {}) {
  while (true) {
    const suffix = current ? ` [Enter keeps ${options.secret ? 'configured value' : current}]` : '';
    const value = (await rl.question(`${label}${suffix}: `)).trim();
    if (value) return value;
    if (current) return current;
    console.log(`${label} is required.`);
  }
}

async function collectCredentials(rl, values) {
  console.log('\nTrakt application credentials');
  console.log('Create or inspect the application at https://trakt.tv/oauth/applications');
  console.log('The redirect URI is case-sensitive and must exactly match the URI in that application.');
  const clientId = await promptRequired(rl, 'Client ID', values.get('TRAKT_CLIENT_ID') ?? '');
  const clientSecret = await promptRequired(
    rl,
    'Client secret (input is visible)',
    values.get('TRAKT_CLIENT_SECRET') ?? '',
    { secret: true }
  );
  const redirectUri = await promptRequired(
    rl,
    'Exact configured redirect URI',
    values.get('TRAKT_REDIRECT_URI') ?? ''
  );

  let apiBaseUrl = '';
  let suggestedApiBaseUrl = values.get('TRAKT_API_BASE_URL') ?? 'https://api.trakt.tv';
  while (true) {
    const candidate = await promptRequired(rl, 'Trakt API base URL', suggestedApiBaseUrl);
    try {
      const parsed = new URL(candidate);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        console.log('Trakt API base URL must use HTTP or HTTPS.');
        suggestedApiBaseUrl = '';
        continue;
      }
      if (parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/') {
        console.log('Use only the API origin, for example https://api.trakt.tv.');
        suggestedApiBaseUrl = '';
        continue;
      }
      apiBaseUrl = parsed.origin;
      break;
    } catch {
      console.log('Invalid URL format. Enter a complete URL such as https://api.trakt.tv.');
      suggestedApiBaseUrl = '';
    }
  }

  return {
    clientId,
    clientSecret,
    redirectUri,
    apiBaseUrl
  };
}

async function chooseRetry(rl, message, options = 'retry/edit/skip') {
  console.log(`\n${message}`);
  while (true) {
    if (options === 'refresh') {
      const answer = (await rl.question('[r] retry refresh  [e] edit secret/redirect  [n] new device code  [s] skip: ')).trim().toLowerCase();
      if (['r', 'retry'].includes(answer)) return 'retry';
      if (['e', 'edit'].includes(answer)) return 'edit';
      if (['n', 'new'].includes(answer)) return 'new';
      if (['s', 'skip', 'q', 'quit'].includes(answer)) return 'skip';
    } else {
      const answer = (await rl.question('[r] request a new code  [e] edit credentials  [s] skip: ')).trim().toLowerCase();
      if (['r', 'retry', 'new'].includes(answer)) return 'retry';
      if (['e', 'edit'].includes(answer)) return 'edit';
      if (['s', 'skip', 'q', 'quit'].includes(answer)) return 'skip';
    }
    console.log('Choose one of the listed options.');
  }
}

async function validateRefreshToken(rl, credentials, deviceToken, userAgent) {
  let current = { ...credentials };
  while (true) {
    try {
      console.log('\nValidating refresh-token rotation…');
      const refreshed = await refreshTraktToken(
        current.apiBaseUrl,
        current.clientId,
        current.clientSecret,
        deviceToken.refresh_token,
        current.redirectUri,
        userAgent
      );
      return { credentials: current, token: refreshed };
    } catch (error) {
      console.error(`Refresh validation failed: ${describeError(error)}`);
      console.error('The most common cause is a redirect URI or client secret that does not exactly match the Trakt application.');
      const action = await chooseRetry(rl, 'Choose how to continue.', 'refresh');
      if (action === 'retry') continue;
      if (action === 'new') return null;
      if (action === 'skip') return 'skip';
      current.clientSecret = await promptRequired(rl, 'Client secret (input is visible)', '', { secret: true });
      current.redirectUri = await promptRequired(rl, 'Exact configured redirect URI', current.redirectUri);
    }
  }
}

async function resetPersistedState(envFile, values) {
  const configured = values.get('TRAKT_SYNC_STATE_FILE') || './data/trakt-sync-state.json';
  const stateFile = path.isAbsolute(configured)
    ? configured
    : path.resolve(path.dirname(envFile), configured);
  await fs.rm(stateFile, { force: true });
  return stateFile;
}

async function persistSuccess(envFile, originalRaw, originalValues, credentials, token) {
  const nowSec = Math.floor(Date.now() / 1000);
  const expiresIn = Number.isFinite(token.expires_in) && token.expires_in > 0
    ? Math.floor(token.expires_in)
    : 7 * 24 * 60 * 60;
  const createdAt = Number.isFinite(token.created_at) && token.created_at > 0
    ? Math.floor(token.created_at)
    : nowSec;
  const syncMins = /^\d+$/.test(originalValues.get('TRAKT_SYNC_MINS') ?? '')
    ? originalValues.get('TRAKT_SYNC_MINS')
    : '360';
  const generation = randomBytes(12).toString('base64url');
  const updates = new Map([
    ['TRAKT_SYNC_ENABLED', 'true'],
    ['TRAKT_SYNC_MINS', syncMins],
    ['TRAKT_API_BASE_URL', credentials.apiBaseUrl],
    ['TRAKT_CLIENT_ID', credentials.clientId],
    ['TRAKT_CLIENT_SECRET', credentials.clientSecret],
    ['TRAKT_REFRESH_TOKEN', token.refresh_token],
    ['TRAKT_ACCESS_TOKEN', token.access_token],
    ['TRAKT_ACCESS_TOKEN_CREATED_AT', String(createdAt)],
    ['TRAKT_ACCESS_TOKEN_EXPIRES_IN', String(expiresIn)],
    ['TRAKT_REDIRECT_URI', credentials.redirectUri],
    ['TRAKT_AUTH_GENERATION', generation]
  ]);
  const nextRaw = updateEnvContent(originalRaw, updates);
  await atomicWriteEnv(envFile, nextRaw);
  const nextValues = parseEnv(nextRaw);
  const resetFile = await resetPersistedState(envFile, nextValues);
  return { generation, resetFile };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const envFile = path.resolve(args.envFile);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const userAgent = `stremio-addarr/${args.appVersion}`;

  try {
    let env = await readEnvFile(envFile);
    let credentials = await collectCredentials(rl, env.values);

    while (true) {
      try {
        console.log('\nRequesting a Trakt device code…');
        const device = await requestTraktDeviceCode(
          credentials.apiBaseUrl,
          credentials.clientId,
          userAgent
        );
        const activationUrl = `${device.verification_url.replace(/\/+$/, '')}/${encodeURIComponent(device.user_code)}`;
        console.log('\nAuthorize this server:');
        console.log(`  Code: ${device.user_code}`);
        console.log(`  Open: ${activationUrl}`);
        console.log(`  Expires in: ${Math.ceil(device.expires_in / 60)} minute(s)`);
        console.log('\nWaiting for approval. The script obeys Trakt\'s polling interval automatically.');

        const deviceToken = await pollTraktDeviceToken({
          apiBaseUrl: credentials.apiBaseUrl,
          clientId: credentials.clientId,
          clientSecret: credentials.clientSecret,
          userAgent,
          device,
          onStatus(status, detail) {
            if (status === 'pending') process.stdout.write('.');
            else if (status === 'slow_down') console.log(`\nTrakt requested slower polling; next interval is ${detail}s.`);
            else console.log(`\nTemporary polling problem: ${detail ?? status}`);
          }
        });
        process.stdout.write('\n');

        const validated = await validateRefreshToken(rl, credentials, deviceToken, userAgent);
        if (validated === 'skip') return 2;
        if (validated === null) continue;
        credentials = validated.credentials;

        console.log('Verifying the authorised Trakt account…');
        await verifyTraktAccessToken(
          credentials.apiBaseUrl,
          credentials.clientId,
          validated.token.access_token,
          userAgent
        );

        env = await readEnvFile(envFile);
        const persisted = await persistSuccess(
          envFile,
          env.raw,
          env.values,
          credentials,
          validated.token
        );
        console.log('\nTrakt authentication succeeded.');
        console.log(`  Client ID: ${mask(credentials.clientId)}`);
        console.log('  Access and refresh tokens: stored securely in .env (not printed)');
        console.log(`  Previous runtime state reset: ${persisted.resetFile}`);
        console.log('  Watched sync: enabled');
        return 0;
      } catch (error) {
        console.error(`\nTrakt authentication failed: ${describeError(error)}`);
        const action = await chooseRetry(rl, 'No settings were enabled from this failed attempt.');
        if (action === 'skip') return 2;
        if (action === 'edit') {
          env = await readEnvFile(envFile);
          credentials = await collectCredentials(rl, new Map([
            ...env.values,
            ['TRAKT_CLIENT_ID', credentials.clientId],
            ['TRAKT_CLIENT_SECRET', credentials.clientSecret],
            ['TRAKT_REDIRECT_URI', credentials.redirectUri],
            ['TRAKT_API_BASE_URL', credentials.apiBaseUrl]
          ]));
        }
      }
    }
  } finally {
    rl.close();
  }
}

main().then(
  (code) => { process.exitCode = code; },
  (error) => {
    console.error(`Fatal Trakt setup error: ${describeError(error)}`);
    process.exitCode = 1;
  }
);
