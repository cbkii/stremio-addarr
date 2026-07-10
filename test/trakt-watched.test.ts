import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { TraktWatchedLookup } from '../src/services/trakt-watched.js';
import { createLogger } from '../src/logger.js';
import { baseConfig } from './_helpers.js';

const ORIGINAL_FETCH = globalThis.fetch;

test.afterEach(async () => {
  globalThis.fetch = ORIGINAL_FETCH;
});

test('sync interval gating prevents repeated full sync within interval', async () => {
  const cfg = baseConfig();
  cfg.traktSync.enabled = true;
  cfg.traktSync.syncMins = 360;
  cfg.traktSync.clientId = 'id';
  cfg.traktSync.clientSecret = 'secret';
  cfg.traktSync.refreshToken = 'refresh';
  cfg.traktSync.stateFilePath = path.join(os.tmpdir(), `trakt-sync-${Date.now()}-1.json`);

  let tokenCalls = 0;
  let movieCalls = 0;
  let showCalls = 0;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/oauth/token')) {
      tokenCalls++;
      return new Response('{"access_token":"a","refresh_token":"r2"}', { status: 200 });
    }
    if (url.endsWith('/sync/watched/movies')) {
      movieCalls++;
      return new Response('[{"movie":{"ids":{"imdb":"tt1"}}}]', { status: 200 });
    }
    if (url.endsWith('/sync/watched/shows')) {
      showCalls++;
      return new Response('[]', { status: 200 });
    }
    return new Response('{}', { status: 404 });
  }) as typeof fetch;

  const lookup = new TraktWatchedLookup(cfg, createLogger('none'));
  await lookup.init();
  await lookup.isMovieWatched('tt1');
  await lookup.isMovieWatched('tt1');
  assert.equal(tokenCalls, 1);
  assert.equal(movieCalls, 1);
  assert.equal(showCalls, 1);
});

test('sync state persists last successful timestamp to disk', async () => {
  const cfg = baseConfig();
  cfg.traktSync.enabled = true;
  cfg.traktSync.syncMins = 1;
  cfg.traktSync.clientId = 'id';
  cfg.traktSync.clientSecret = 'secret';
  cfg.traktSync.refreshToken = 'refresh';
  cfg.traktSync.stateFilePath = path.join(os.tmpdir(), `trakt-sync-${Date.now()}-2.json`);

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/oauth/token')) return new Response('{"access_token":"a","refresh_token":"r2"}', { status: 200 });
    if (url.endsWith('/sync/watched/movies')) return new Response('[]', { status: 200 });
    if (url.endsWith('/sync/watched/shows')) return new Response('[]', { status: 200 });
    return new Response('{}', { status: 404 });
  }) as typeof fetch;

  const lookup = new TraktWatchedLookup(cfg, createLogger('none'));
  await lookup.init();
  await lookup.triggerSync();
  const raw = await fs.readFile(cfg.traktSync.stateFilePath, 'utf8');
  const parsed = JSON.parse(raw) as { lastSyncAt?: number; refreshToken?: string };
  assert.equal(typeof parsed.lastSyncAt, 'number');
  assert.ok((parsed.lastSyncAt ?? 0) > 0);
  assert.equal(parsed.refreshToken, 'r2');
});

test('fallback to unwatched when Trakt API fails', async () => {
  const cfg = baseConfig();
  cfg.traktSync.enabled = true;
  cfg.traktSync.clientId = 'id';
  cfg.traktSync.clientSecret = 'secret';
  cfg.traktSync.refreshToken = 'refresh';
  cfg.traktSync.stateFilePath = path.join(os.tmpdir(), `trakt-sync-${Date.now()}-3.json`);

  globalThis.fetch = (async (_input: RequestInfo | URL) => {
    return new Response('{}', { status: 500 });
  }) as typeof fetch;

  const lookup = new TraktWatchedLookup(cfg, createLogger('none'));
  await lookup.init();
  const watched = await lookup.isMovieWatched('tt1');
  assert.equal(watched, false);
});

test('sync lock avoids overlapping sync runs', async () => {
  const cfg = baseConfig();
  cfg.traktSync.enabled = true;
  cfg.traktSync.clientId = 'id';
  cfg.traktSync.clientSecret = 'secret';
  cfg.traktSync.refreshToken = 'refresh';
  cfg.traktSync.stateFilePath = path.join(os.tmpdir(), `trakt-sync-${Date.now()}-4.json`);

  let tokenCalls = 0;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/oauth/token')) {
      tokenCalls++;
      await new Promise((resolve) => setTimeout(resolve, 30));
      return new Response('{"access_token":"a","refresh_token":"r2"}', { status: 200 });
    }
    if (url.endsWith('/sync/watched/movies')) return new Response('[]', { status: 200 });
    if (url.endsWith('/sync/watched/shows')) return new Response('[]', { status: 200 });
    return new Response('{}', { status: 404 });
  }) as typeof fetch;

  const lookup = new TraktWatchedLookup(cfg, createLogger('none'));
  await lookup.init();
  await Promise.all([lookup.triggerSync(), lookup.triggerSync()]);
  assert.equal(tokenCalls, 1);
});

test('cache rebuild performs atomic swap and does not expose empty state during sync', async () => {
  const cfg = baseConfig();
  cfg.traktSync.enabled = true;
  cfg.traktSync.syncMins = 360;
  cfg.traktSync.clientId = 'id';
  cfg.traktSync.clientSecret = 'secret';
  cfg.traktSync.refreshToken = 'refresh';
  cfg.traktSync.stateFilePath = path.join(os.tmpdir(), `trakt-sync-${Date.now()}-5.json`);

  let resolveSyncEntered: () => void;
  const syncEnteredPromise = new Promise<void>(r => resolveSyncEntered = r);

  let resolveMoviesSync: () => void;
  const syncBlockedPromise = new Promise<void>(r => resolveMoviesSync = r);

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/oauth/token')) return new Response('{"access_token":"a","refresh_token":"r2"}', { status: 200 });
    if (url.endsWith('/sync/watched/movies')) {
      resolveSyncEntered();
      await syncBlockedPromise;
      return new Response('[{"movie":{"ids":{"imdb":"tt2000"}}}]', { status: 200 });
    }
    if (url.endsWith('/sync/watched/shows')) {
      return new Response('[]', { status: 200 });
    }
    return new Response('{}', { status: 404 });
  }) as typeof fetch;

  const lookup = new TraktWatchedLookup(cfg, createLogger('none'));
  await lookup.init();

  // Set an initial state
  lookup['movieWatched'] = new Set(['tt1000']);
  lookup['snapshotReady'] = true;

  const syncPromise = lookup.triggerSync();

  // Wait until we are inside the sync HTTP call
  await syncEnteredPromise;

  // Because `areMoviesWatched` calls `ensureSynced`, which blocks on the running sync,
  // we check the state manually bypassing the block to verify atomic swap while pending.
  assert.equal(lookup['movieWatched'].has('tt1000'), true, 'concurrent read should still see old state');
  assert.equal(lookup['movieWatched'].has('tt2000'), false, 'concurrent read should not see new state yet');

  resolveMoviesSync!();

  await syncPromise;

  const finalResult = await lookup.areMoviesWatched(['tt1000', 'tt2000']);
  assert.equal(finalResult.get('tt1000'), false, 'final read should see old state removed');
  assert.equal(finalResult.get('tt2000'), true, 'final read should see new state');
});

test('failed sync preserves the previous known-good state', async () => {
  const cfg = baseConfig();
  cfg.traktSync.enabled = true;
  cfg.traktSync.syncMins = 360;
  cfg.traktSync.clientId = 'id';
  cfg.traktSync.clientSecret = 'secret';
  cfg.traktSync.refreshToken = 'refresh';
  cfg.traktSync.stateFilePath = path.join(os.tmpdir(), `trakt-sync-${Date.now()}-fail.json`);

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/oauth/token')) return new Response('{"access_token":"a","refresh_token":"r2"}', { status: 200 });
    if (url.endsWith('/sync/watched/movies')) {
      return new Response('', { status: 500 });
    }
    if (url.endsWith('/sync/watched/shows')) {
      return new Response('[]', { status: 200 });
    }
    return new Response('{}', { status: 404 });
  }) as typeof fetch;

  const lookup = new TraktWatchedLookup(cfg, createLogger('none'));
  await lookup.init();
  lookup['movieWatched'] = new Set(['tt1000']);
  lookup['snapshotReady'] = true;

  await lookup.triggerSync();

  const finalResult = await lookup.areMoviesWatched(['tt1000']);
  assert.equal(finalResult.get('tt1000'), true, 'old state should be preserved on sync failure');
});

test('snapshot state remains unwatched when fresh process starts despite valid lastSyncAt cache', async () => {
  const cfg = baseConfig();
  cfg.traktSync.enabled = true;
  cfg.traktSync.syncMins = 360;
  cfg.traktSync.clientId = 'id';
  cfg.traktSync.clientSecret = 'secret';
  cfg.traktSync.refreshToken = 'refresh';
  cfg.traktSync.stateFilePath = path.join(os.tmpdir(), `trakt-sync-${Date.now()}-restart.json`);

  // Write a state file indicating a recent sync
  await fs.mkdir(path.dirname(cfg.traktSync.stateFilePath), { recursive: true });
  await fs.writeFile(cfg.traktSync.stateFilePath, JSON.stringify({
    lastSyncAt: Date.now() - 5000,
    refreshToken: 'refresh',
    accessToken: 'access',
    tokenExpiresAt: Date.now() + 3600000
  }), 'utf8');

  let fetchCalled = false;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/oauth/token')) return new Response('{"access_token":"a","refresh_token":"r2"}', { status: 200 });
    if (url.endsWith('/sync/watched/movies')) {
      fetchCalled = true;
      return new Response('[{"movie":{"ids":{"imdb":"tt2000"}}}]', { status: 200 });
    }
    if (url.endsWith('/sync/watched/shows')) {
      return new Response('[]', { status: 200 });
    }
    return new Response('{}', { status: 404 });
  }) as typeof fetch;

  const lookup = new TraktWatchedLookup(cfg, createLogger('none'));
  await lookup.init();

  const finalResult = await lookup.areMoviesWatched(['tt2000']);
  assert.equal(fetchCalled, true, 'sync should occur because in-memory snapshot was not ready');
  assert.equal(finalResult.get('tt2000'), true, 'sync completed successfully serving valid memory cache');
});

test('failed persistence does not wipe the active synced memory snapshot', async () => {
  const cfg = baseConfig();
  cfg.traktSync.enabled = true;
  cfg.traktSync.syncMins = 360;
  cfg.traktSync.clientId = 'id';
  cfg.traktSync.clientSecret = 'secret';
  cfg.traktSync.refreshToken = 'refresh';
  cfg.traktSync.stateFilePath = '/invalid/directory/path/trakt-sync-fail.json';

  let fetchCalled = false;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/oauth/token')) return new Response('{"access_token":"a","refresh_token":"r2"}', { status: 200 });
    if (url.endsWith('/sync/watched/movies')) {
      fetchCalled = true;
      return new Response('[{"movie":{"ids":{"imdb":"tt2000"}}}]', { status: 200 });
    }
    if (url.endsWith('/sync/watched/shows')) {
      return new Response('[]', { status: 200 });
    }
    return new Response('{}', { status: 404 });
  }) as typeof fetch;

  const lookup = new TraktWatchedLookup(cfg, createLogger('none'));
  await lookup.init();

  await lookup.triggerSync();
  assert.equal(fetchCalled, true, 'sync triggered');
  const finalResult = await lookup.areMoviesWatched(['tt2000']);
  assert.equal(finalResult.get('tt2000'), true, 'sync valid locally despite file-system IO rejection');
});

test('Trakt queries immediately return false and bypass network fetches when provided malformed inputs', async () => {
  const cfg = baseConfig();
  cfg.traktSync.enabled = true;
  cfg.traktSync.clientId = 'id';
  cfg.traktSync.clientSecret = 'secret';
  cfg.traktSync.refreshToken = 'refresh';
  cfg.traktSync.stateFilePath = path.join(os.tmpdir(), `trakt-sync-${Date.now()}-malformed.json`);

  let fetchCalled = false;
  globalThis.fetch = (async (_input: RequestInfo | URL) => {
    fetchCalled = true;
    return new Response('[]', { status: 200 });
  }) as typeof fetch;

  const lookup = new TraktWatchedLookup(cfg, createLogger('none'));
  await lookup.init();

  const m1 = await lookup.isMovieWatched('invalid');
  assert.equal(m1, false);

  const m2 = await lookup.areMoviesWatched([]);
  assert.equal(m2.size, 0);

  const m3 = await lookup.areMoviesWatched(['badID']);
  assert.equal(m3.get('badID'), false);

  const ep = await lookup.isEpisodeWatched('tt2000', undefined, undefined);
  assert.equal(ep, false);

  assert.equal(fetchCalled, false, 'Fetch was incorrectly executed despite inputs strictly failing normalisation blocks.');
});

test('areMoviesWatched returns same keys exactly mapped correctly validating whitespaces and mixed case canonization', async () => {
  const cfg = baseConfig();
  cfg.traktSync.enabled = true;
  cfg.traktSync.syncMins = 360;
  cfg.traktSync.clientId = 'id';
  cfg.traktSync.clientSecret = 'secret';
  cfg.traktSync.refreshToken = 'refresh';
  cfg.traktSync.stateFilePath = path.join(os.tmpdir(), `trakt-sync-${Date.now()}-canon.json`);

  let fetchCalls = 0;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/oauth/token')) return new Response('{"access_token":"a","refresh_token":"r2"}', { status: 200 });
    if (url.endsWith('/sync/watched/movies')) {
      fetchCalls++;
      // Return tt1 and tt2 as watched natively
      return new Response('[{"movie":{"ids":{"imdb":"tt1"}}},{"movie":{"ids":{"imdb":"tt2"}}}]', { status: 200 });
    }
    if (url.endsWith('/sync/watched/shows')) {
      return new Response('[]', { status: 200 });
    }
    return new Response('{}', { status: 404 });
  }) as typeof fetch;

  const lookup = new TraktWatchedLookup(cfg, createLogger('none'));
  await lookup.init();

  const batchIds = [
    'tt1',            // canonical
    'TT1',            // uppercase
    ' tt1 ',          // whitespace
    'tt2',            // unwatched natively
    'tt3',            // missing
    'invalid',        // malformed
    ''                // empty
  ] as const;

  const result = await lookup.areMoviesWatched(batchIds);

  // Verify exact original strings are used as map keys
  for (const id of batchIds) {
    assert.ok(result.has(id), `Map must contain the exact original requested key string: '${id}'`);
  }

  // Exact outputs mapping to canon normalized states
  assert.equal(result.get('tt1'), true);
  assert.equal(result.get('TT1'), true);
  assert.equal(result.get(' tt1 '), true);

  assert.equal(result.get('tt2'), true);
  assert.equal(result.get('tt3'), false);
  assert.equal(result.get('invalid'), false);
  assert.equal(result.get(''), false);

  // Validate only one single fetch was used for the entire normalized batch
  assert.equal(fetchCalls, 1);

  // Validate single lookup equality on uppercase
  const singleUpperCase = await lookup.isMovieWatched('TT1');
  assert.equal(singleUpperCase, true);
});

test('Trakt queries bypass network returning false completely on disabled provider status mapping original keys', async () => {
  const cfg = baseConfig();
  cfg.traktSync.enabled = false;
  cfg.traktSync.clientId = 'id';
  cfg.traktSync.clientSecret = 'secret';
  cfg.traktSync.refreshToken = 'refresh';
  cfg.traktSync.stateFilePath = path.join(os.tmpdir(), `trakt-sync-${Date.now()}-disabled.json`);

  let fetchCalled = false;
  globalThis.fetch = (async (_input: RequestInfo | URL) => {
    fetchCalled = true;
    return new Response('[]', { status: 200 });
  }) as typeof fetch;

  const lookup = new TraktWatchedLookup(cfg, createLogger('none'));
  await lookup.init();

  const m1 = await lookup.isMovieWatched('tt1');
  assert.equal(m1, false);

  const batchIds = ['tt1', 'TT1', 'invalid', ' tt2 '];
  const m2 = await lookup.areMoviesWatched(batchIds);
  assert.equal(m2.size, 4);

  for (const id of batchIds) {
    assert.equal(m2.get(id), false, 'disabled provider must map exact string back to false');
  }

  const ep = await lookup.isEpisodeWatched('tt2', 1, 1);
  assert.equal(ep, false);

  assert.equal(fetchCalled, false, 'Fetch was incorrectly executed on disabled provider.');
});

test('token expiry uses expires_in from response when present', async () => {
  const cfg = baseConfig();
  cfg.traktSync.enabled = true;
  cfg.traktSync.clientId = 'id';
  cfg.traktSync.clientSecret = 'secret';
  cfg.traktSync.refreshToken = 'refresh';
  cfg.traktSync.stateFilePath = path.join(os.tmpdir(), `trakt-sync-${Date.now()}-exp.json`);

  const beforeSync = Date.now();
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/oauth/token')) {
      // Short expires_in so we can verify it's being used
      return new Response('{"access_token":"tok","refresh_token":"r2","expires_in":3600}', { status: 200 });
    }
    if (url.endsWith('/sync/watched/movies')) return new Response('[]', { status: 200 });
    if (url.endsWith('/sync/watched/shows')) return new Response('[]', { status: 200 });
    return new Response('{}', { status: 404 });
  }) as typeof fetch;

  const lookup = new TraktWatchedLookup(cfg, createLogger('none'));
  await lookup.init();
  await lookup.triggerSync();

  // Read persisted state to verify tokenExpiresAt is close to now + 3600s (not 90 days)
  const raw = await fs.readFile(cfg.traktSync.stateFilePath, 'utf8');
  const state = JSON.parse(raw) as { tokenExpiresAt?: number };
  const expectedMax = beforeSync + 3600 * 1000 + 5000; // 5s tolerance
  const expectedMin = beforeSync + 3600 * 1000 - 5000;
  assert.ok(
    state.tokenExpiresAt !== undefined && state.tokenExpiresAt >= expectedMin && state.tokenExpiresAt <= expectedMax,
    `tokenExpiresAt ${state.tokenExpiresAt} should be ~${beforeSync + 3600000} (now + 3600s, not 90 days)`
  );

  globalThis.fetch = ORIGINAL_FETCH;
});
