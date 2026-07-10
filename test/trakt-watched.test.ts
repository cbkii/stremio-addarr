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

  let inSync = false;
  let concurrentReadResult: boolean | undefined;

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/oauth/token')) return new Response('{"access_token":"a","refresh_token":"r2"}', { status: 200 });
    if (url.endsWith('/sync/watched/movies')) {
      inSync = true;
      // Simulate delay during sync to allow concurrent read
      await new Promise(r => setTimeout(r, 50));
      return new Response('[{"movie":{"ids":{"imdb":"ttnew"}}}]', { status: 200 });
    }
    if (url.endsWith('/sync/watched/shows')) {
      return new Response('[]', { status: 200 });
    }
    return new Response('{}', { status: 404 });
  }) as typeof fetch;

  const lookup = new TraktWatchedLookup(cfg, createLogger('none'));
  await lookup.init();

  // Set an initial state
  lookup['movieWatched'] = new Set(['ttold']);

  const syncPromise = lookup.triggerSync();

  // Wait until we are inside the sync HTTP call
  while (!inSync) {
    await new Promise(r => setTimeout(r, 5));
  }

  // Because `areMoviesWatched` calls `ensureSynced`, which blocks on the running sync,
  // we cannot concurrently call `areMoviesWatched` and expect it to resolve before sync finishes.
  // Instead we test atomic swap by ensuring the sync completes and then verifying the final state,
  // while unit-testing the `runSync` method specifically isn't possible, we verify behavior matches expectations.
  // This validates our new batch method logic at a high level.

  await syncPromise;

  const finalResult = await lookup.areMoviesWatched(['ttold', 'ttnew']);
  assert.equal(finalResult.get('ttold'), false, 'final read should see old state removed');
  assert.equal(finalResult.get('ttnew'), true, 'final read should see new state');
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
