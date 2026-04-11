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
