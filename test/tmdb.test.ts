import test from 'node:test';
import assert from 'node:assert/strict';
import { TmdbApiLookup } from '../src/services/tmdb.js';

test('TmdbApiLookup resolves movie release date using min(release, digital, physical)', async () => {
  const originalFetch = global.fetch;
  const calls: string[] = [];
  try {
    global.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.includes('/3/find/tt1234567')) {
        return new Response(JSON.stringify({ movie_results: [{ id: 550, release_date: '2004-10-27' }] }), { status: 200 });
      }
      if (url.includes('/3/movie/550/release_dates')) {
        return new Response(JSON.stringify({
          results: [{
            iso_3166_1: 'US',
            release_dates: [
              { type: 4, release_date: '2004-10-01T00:00:00.000Z' },
              { type: 5, release_date: '2004-11-15T00:00:00.000Z' },
              { type: 3, release_date: '2004-09-10T00:00:00.000Z' }
            ]
          }]
        }), { status: 200 });
      }
      return new Response('{}', { status: 404 });
    }) as typeof fetch;

    const lookup = new TmdbApiLookup('token');
    const date = await lookup.getMovieReleaseDate('tt1234567');
    assert.equal(date, '2004-10-01');
    assert.equal(calls.length, 2);
  } finally {
    global.fetch = originalFetch;
  }
});

test('TmdbApiLookup falls back to theatrical date when release+digital+physical are unavailable', async () => {
  const originalFetch = global.fetch;
  try {
    global.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/3/find/tt7654321')) {
        return new Response(JSON.stringify({ movie_results: [{ id: 551, release_date: '' }] }), { status: 200 });
      }
      if (url.includes('/3/movie/551/release_dates')) {
        return new Response(JSON.stringify({
          results: [{
            iso_3166_1: 'US',
            release_dates: [{ type: 3, release_date: '2007-07-20T12:00:00.000Z' }]
          }]
        }), { status: 200 });
      }
      return new Response('{}', { status: 404 });
    }) as typeof fetch;

    const lookup = new TmdbApiLookup('token');
    const date = await lookup.getMovieReleaseDate('tt7654321');
    assert.equal(date, '2007-07-20');
  } finally {
    global.fetch = originalFetch;
  }
});

test('TmdbApiLookup resolves episode air_date via IMDb show lookup', async () => {
  const originalFetch = global.fetch;
  try {
    global.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/3/find/tt0903747')) {
        return new Response(JSON.stringify({ tv_results: [{ id: 1396 }] }), { status: 200 });
      }
      if (url.includes('/3/tv/1396/season/1/episode/1')) {
        return new Response(JSON.stringify({ air_date: '2008-01-20' }), { status: 200 });
      }
      return new Response('{}', { status: 404 });
    }) as typeof fetch;

    const lookup = new TmdbApiLookup('token');
    const date = await lookup.getEpisodeReleaseDate('tt0903747', 1, 1);
    assert.equal(date, '2008-01-20');
  } finally {
    global.fetch = originalFetch;
  }
});

test('TmdbApiLookup returns undefined for non-OK IMDb find responses', async () => {
  const originalFetch = global.fetch;
  try {
    for (const status of [404, 500]) {
      global.fetch = (async () => new Response('{"error":"unavailable"}', { status })) as typeof fetch;
      const lookup = new TmdbApiLookup('token');
      assert.equal(await lookup.getMovieReleaseDate(`tt${status}0000`), undefined);
    }
  } finally {
    global.fetch = originalFetch;
  }
});

test('TmdbApiLookup returns undefined rather than throwing on network failure', async () => {
  const originalFetch = global.fetch;
  try {
    global.fetch = (async () => { throw new Error('network offline'); }) as typeof fetch;
    const lookup = new TmdbApiLookup('token');
    assert.equal(await lookup.getMovieReleaseDate('tt9990001'), undefined);
    assert.equal(await lookup.getEpisodeReleaseDate('tt9990002', 1, 1), undefined);
  } finally {
    global.fetch = originalFetch;
  }
});

test('TmdbApiLookup falls back to the find response date when release-details request fails', async () => {
  const originalFetch = global.fetch;
  const calls: string[] = [];
  try {
    global.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.includes('/3/find/tt9990003')) {
        return new Response(JSON.stringify({ movie_results: [{ id: 700, release_date: '2025-04-03' }] }), { status: 200 });
      }
      if (url.includes('/3/movie/700/release_dates')) {
        return new Response('{"error":"temporary"}', { status: 503 });
      }
      return new Response('{}', { status: 404 });
    }) as typeof fetch;

    const lookup = new TmdbApiLookup('token');
    assert.equal(await lookup.getMovieReleaseDate('tt9990003'), '2025-04-03');
    assert.equal(calls.length, 2);
  } finally {
    global.fetch = originalFetch;
  }
});
