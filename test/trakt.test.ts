import test from 'node:test';
import assert from 'node:assert/strict';
import { NoopTraktLookup, TraktApiLookup } from '../src/services/trakt.js';

const ORIGINAL_FETCH = globalThis.fetch;

test.afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

test('NoopTraktLookup returns no data without scraping the website', async () => {
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return new Response('', { status: 500 });
  }) as typeof fetch;

  const lookup = new NoopTraktLookup();
  assert.equal(await lookup.getMovieReleaseDate('tt0000001'), undefined);
  assert.equal(await lookup.getEpisodeReleaseDate('tt0000002', 1, 1), undefined);
  assert.equal(calls, 0);
});

test('TraktApiLookup resolves and caches a movie release date', async () => {
  let calls = 0;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    calls += 1;
    assert.match(String(input), /\/search\/imdb\/tt0468569\?type=movie/);
    return new Response(JSON.stringify([
      { type: 'movie', movie: { released: '2008-07-18', ids: {} } }
    ]), { status: 200 });
  }) as typeof fetch;

  const lookup = new TraktApiLookup('client-id', 'https://api.trakt.tv', '1.6.5');
  assert.equal(await lookup.getMovieReleaseDate('tt0468569'), '2008-07-18');
  assert.equal(await lookup.getMovieReleaseDate('tt0468569'), '2008-07-18');
  assert.equal(calls, 1);
});

test('TraktApiLookup caches movie not-found results', async () => {
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return new Response('[]', { status: 200 });
  }) as typeof fetch;

  const lookup = new TraktApiLookup('client-id');
  assert.equal(await lookup.getMovieReleaseDate('tt9999999'), undefined);
  assert.equal(await lookup.getMovieReleaseDate('tt9999999'), undefined);
  assert.equal(calls, 1);
});

test('TraktApiLookup resolves episode first_aired through the show slug', async () => {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/search/imdb/tt0903747') && url.includes('type=show')) {
      return new Response(JSON.stringify([
        { type: 'show', show: { ids: { slug: 'breaking-bad' } } }
      ]), { status: 200 });
    }
    if (url.includes('/shows/breaking-bad/seasons/1/episodes/1')) {
      return new Response(JSON.stringify({ first_aired: '2008-01-20T02:00:00.000Z' }), { status: 200 });
    }
    return new Response('[]', { status: 200 });
  }) as typeof fetch;

  const lookup = new TraktApiLookup('client-id');
  assert.equal(await lookup.getEpisodeReleaseDate('tt0903747', 1, 1), '2008-01-20');
});

test('TraktApiLookup sends all required application headers and configured API origin', async () => {
  let capturedUrl = '';
  let capturedHeaders = new Headers();
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    capturedUrl = String(input);
    capturedHeaders = new Headers(init?.headers);
    return new Response('[]', { status: 200 });
  }) as typeof fetch;

  const lookup = new TraktApiLookup('my-client-id', 'https://trakt-api.example', '1.6.5');
  await lookup.getMovieReleaseDate('tt0000004');

  assert.match(capturedUrl, /^https:\/\/trakt-api\.example\//);
  assert.equal(capturedHeaders.get('content-type'), 'application/json');
  assert.equal(capturedHeaders.get('trakt-api-key'), 'my-client-id');
  assert.equal(capturedHeaders.get('trakt-api-version'), '2');
  assert.equal(capturedHeaders.get('user-agent'), 'stremio-addarr/1.6.5');
});

test('TraktApiLookup returns undefined gracefully on network errors', async () => {
  globalThis.fetch = (async () => {
    throw new Error('network failure');
  }) as typeof fetch;

  const lookup = new TraktApiLookup('client-id');
  assert.equal(await lookup.getMovieReleaseDate('tt0000003'), undefined);
});
