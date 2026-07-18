import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  TraktAuthError,
  pollTraktDeviceToken,
  traktTokenTiming
} from '../src/services/trakt-auth.js';
import { TraktWatchedLookup } from '../src/services/trakt-watched.js';
import { createLogger } from '../src/logger.js';
import { baseConfig } from './_helpers.js';

const ORIGINAL_FETCH = globalThis.fetch;
const temporaryPaths: string[] = [];

test.afterEach(async () => {
  globalThis.fetch = ORIGINAL_FETCH;
  await Promise.all(temporaryPaths.splice(0).map((entry) => fs.rm(entry, { recursive: true, force: true })));
});

test('device flow observes pending and slow-down responses before success', async () => {
  let now = 0;
  const waits: number[] = [];
  const responses = [
    new Response('{"error":"authorization_pending"}', { status: 400 }),
    new Response('{"error":"slow_down"}', { status: 429, headers: { 'retry-after': '2' } }),
    new Response('{"access_token":"access","refresh_token":"refresh","expires_in":604800,"created_at":10}', { status: 200 })
  ];
  const statuses: string[] = [];

  const token = await pollTraktDeviceToken({
    apiBaseUrl: 'https://api.trakt.tv',
    clientId: 'client',
    clientSecret: 'secret',
    userAgent: 'stremio-addarr/test',
    device: {
      device_code: 'device',
      user_code: 'ABCD1234',
      verification_url: 'https://trakt.tv/activate',
      expires_in: 120,
      interval: 1
    },
    fetchImpl: (async () => responses.shift() ?? new Response('{}', { status: 500 })) as typeof fetch,
    now: () => now,
    sleep: async (ms) => { waits.push(ms); now += ms; },
    onStatus: (status) => statuses.push(status)
  });

  assert.equal(token.access_token, 'access');
  assert.deepEqual(statuses, ['pending', 'slow_down']);
  assert.ok(waits[1] >= 1_000);
  assert.ok(waits[2] >= 2_000);
});

test('device flow reports terminal denial and expiry statuses', async () => {
  let now = 0;
  await assert.rejects(
    pollTraktDeviceToken({
      apiBaseUrl: 'https://api.trakt.tv',
      clientId: 'client',
      clientSecret: 'secret',
      userAgent: 'stremio-addarr/test',
      device: {
        device_code: 'device',
        user_code: 'ABCD1234',
        verification_url: 'https://trakt.tv/activate',
        expires_in: 30,
        interval: 1
      },
      fetchImpl: (async () => new Response('{"error":"access_denied"}', { status: 418 })) as typeof fetch,
      now: () => now,
      sleep: async (ms) => { now += ms; }
    }),
    (error: unknown) => error instanceof TraktAuthError
      && error.message === 'trakt_device_authorization_denied'
  );
});

test('token timing uses provider metadata and refreshes before the seven-day expiry', () => {
  const timing = traktTokenTiming({ created_at: 1_000, expires_in: 604_800 }, 1_000_000);
  assert.equal(timing.createdAtSec, 1_000);
  assert.equal(timing.expiresInSec, 604_800);
  assert.ok(timing.refreshAtMs < timing.expiresAtMs);
  assert.ok(timing.refreshAtMs >= 1_000_000);
});

function watchedConfig(suffix: string) {
  const config = baseConfig();
  const directory = path.join(os.tmpdir(), `stremio-addarr-trakt-${Date.now()}-${suffix}`);
  temporaryPaths.push(directory);
  config.traktSync.enabled = true;
  config.traktSync.clientId = 'client';
  config.traktSync.clientSecret = 'secret';
  config.traktSync.redirectUri = 'https://example.invalid/trakt/callback';
  config.traktSync.refreshToken = 'refresh-env';
  config.traktSync.accessToken = 'access-env';
  config.traktSync.accessTokenCreatedAt = Math.floor(Date.now() / 1000);
  config.traktSync.accessTokenExpiresIn = 604_800;
  config.traktSync.authGeneration = 'generation-new';
  config.traktSync.stateFilePath = path.join(directory, 'state.json');
  return config;
}

test('valid initial device token is used without an unnecessary refresh', async () => {
  const config = watchedConfig('initial');
  let tokenCalls = 0;
  const authorizations: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/oauth/token')) {
      tokenCalls += 1;
      return new Response('{}', { status: 500 });
    }
    authorizations.push(new Headers(init?.headers).get('authorization') ?? '');
    if (url.endsWith('/sync/watched/movies')) return new Response('[{"movie":{"ids":{"imdb":"tt1"}}}]', { status: 200 });
    if (url.endsWith('/sync/watched/shows')) return new Response('[]', { status: 200 });
    return new Response('{}', { status: 404 });
  }) as typeof fetch;

  const lookup = new TraktWatchedLookup(config, createLogger('none'), { sleep: async () => undefined });
  await lookup.init();
  assert.equal(await lookup.isMovieWatched('tt1'), true);
  assert.equal(tokenCalls, 0);
  assert.ok(authorizations.every((header) => header === 'Bearer access-env'));
});

test('new authentication generation ignores stale persisted credentials', async () => {
  const config = watchedConfig('generation');
  await fs.mkdir(path.dirname(config.traktSync.stateFilePath), { recursive: true });
  await fs.writeFile(config.traktSync.stateFilePath, JSON.stringify({
    schemaVersion: 2,
    authGeneration: 'generation-old',
    refreshToken: 'refresh-old',
    accessToken: 'access-old',
    tokenExpiresAt: Date.now() + 100_000
  }));

  const authorizations: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    authorizations.push(new Headers(init?.headers).get('authorization') ?? '');
    if (url.endsWith('/sync/watched/movies') || url.endsWith('/sync/watched/shows')) {
      return new Response('[]', { status: 200 });
    }
    return new Response('{}', { status: 404 });
  }) as typeof fetch;

  const lookup = new TraktWatchedLookup(config, createLogger('none'), { sleep: async () => undefined });
  await lookup.init();
  await lookup.triggerSync();
  assert.ok(authorizations.every((header) => header === 'Bearer access-env'));
});

test('401 refreshes once, retries the request and writes mode 0600 state', async () => {
  const config = watchedConfig('refresh');
  config.traktSync.accessToken = 'expired-access';
  let movieCalls = 0;
  let tokenCalls = 0;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/oauth/token')) {
      tokenCalls += 1;
      const body = JSON.parse(String(init?.body)) as Record<string, string>;
      assert.equal(body['redirect_uri'], config.traktSync.redirectUri);
      return new Response(JSON.stringify({
        access_token: 'fresh-access',
        refresh_token: 'fresh-refresh',
        expires_in: 604_800,
        created_at: Math.floor(Date.now() / 1000)
      }), { status: 200 });
    }
    if (url.endsWith('/sync/watched/movies')) {
      movieCalls += 1;
      if (movieCalls === 1) return new Response('{"error":"unauthorized"}', { status: 401 });
      assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer fresh-access');
      return new Response('[{"movie":{"ids":{"imdb":"tt2"}}}]', { status: 200 });
    }
    if (url.endsWith('/sync/watched/shows')) return new Response('[]', { status: 200 });
    return new Response('{}', { status: 404 });
  }) as typeof fetch;

  const lookup = new TraktWatchedLookup(config, createLogger('none'), { sleep: async () => undefined });
  await lookup.init();
  assert.equal(await lookup.isMovieWatched('tt2'), true);
  assert.equal(tokenCalls, 1);
  assert.equal(movieCalls, 2);

  const state = JSON.parse(await fs.readFile(config.traktSync.stateFilePath, 'utf8')) as Record<string, unknown>;
  assert.equal(state['authGeneration'], 'generation-new');
  assert.equal(state['refreshToken'], 'fresh-refresh');
  assert.equal((await fs.stat(config.traktSync.stateFilePath)).mode & 0o777, 0o600);
});
