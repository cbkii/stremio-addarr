import test from 'node:test';
import assert from 'node:assert/strict';
import { TraktWatchedLookup } from '../src/services/trakt-watched.js';
import { createLogger } from '../src/logger.js';
import { baseConfig } from './_helpers.js';

const ORIGINAL_FETCH = globalThis.fetch;

test.afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

test('first watched lookup waits for shared persisted-state initialization before syncing', async () => {
  const cfg = baseConfig();
  cfg.traktSync.enabled = true;
  cfg.traktSync.syncMins = 360;
  cfg.traktSync.clientId = 'id';
  cfg.traktSync.clientSecret = 'secret';
  cfg.traktSync.refreshToken = 'environment-refresh';

  let releaseInitialization!: () => void;
  const initializationGate = new Promise<void>((resolve) => {
    releaseInitialization = resolve;
  });
  let signalInitializationStarted!: () => void;
  const initializationStarted = new Promise<void>((resolve) => {
    signalInitializationStarted = resolve;
  });

  const requests: Array<{ url: string; authorization: string | null }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    requests.push({ url, authorization: headers.get('authorization') });
    if (url.endsWith('/oauth/token')) {
      return new Response('{"access_token":"unexpected-refresh","refresh_token":"unexpected-refresh-token","expires_in":3600}', { status: 200 });
    }
    if (url.endsWith('/sync/watched/movies')) {
      return new Response('[{"movie":{"ids":{"imdb":"tt1"}}}]', { status: 200 });
    }
    if (url.endsWith('/sync/watched/shows')) {
      return new Response('[]', { status: 200 });
    }
    return new Response('{}', { status: 404 });
  }) as typeof fetch;

  const lookup = new TraktWatchedLookup(cfg, createLogger('none'));
  let loadCalls = 0;
  lookup['loadState'] = async () => {
    loadCalls += 1;
    signalInitializationStarted();
    await initializationGate;
    lookup['accessToken'] = 'persisted-access';
    lookup['refreshToken'] = 'persisted-refresh';
    lookup['tokenRefreshAt'] = Date.now() + 60_000;
    lookup['tokenExpiresAt'] = Date.now() + 120_000;
  };

  const initPromise = lookup.init();
  const watchedPromise = lookup.isMovieWatched('tt1');

  await initializationStarted;
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(requests.length, 0, 'sync/network work must not start while persisted state is still loading');

  releaseInitialization();
  const [, watched] = await Promise.all([initPromise, watchedPromise]);

  assert.equal(loadCalls, 1, 'init and first lookup must share one state-load promise');
  assert.equal(watched, true);
  assert.equal(requests.some(({ url }) => url.endsWith('/oauth/token')), false, 'loaded access token should avoid an unnecessary refresh');
  const movieRequest = requests.find(({ url }) => url.endsWith('/sync/watched/movies'));
  assert.equal(movieRequest?.authorization, 'Bearer persisted-access');
});
