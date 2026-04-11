import test from 'node:test';
import assert from 'node:assert/strict';
import { TraktHtmlLookup, TraktApiLookup } from '../src/services/trakt.js';

const ORIGINAL_FETCH = globalThis.fetch;

test.afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

// ---------------------------------------------------------------------------
// TraktHtmlLookup — TtlCache undefined fix
// ---------------------------------------------------------------------------

test('TraktHtmlLookup caches a not-found result so Trakt is not re-fetched', async () => {
  let fetchCount = 0;
  globalThis.fetch = (async (_input: RequestInfo | URL) => {
    fetchCount++;
    return new Response('', { status: 404 });
  }) as typeof fetch;

  const lookup = new TraktHtmlLookup();
  const first = await lookup.getMovieReleaseDate('tt0000001');
  const second = await lookup.getMovieReleaseDate('tt0000001');

  assert.equal(first, undefined);
  assert.equal(second, undefined);
  // The 404 response should be cached after the first call; only one fetch needed.
  assert.equal(fetchCount, 1);
});

test('TraktHtmlLookup caches an episode not-found result', async () => {
  let fetchCount = 0;
  globalThis.fetch = (async (_input: RequestInfo | URL) => {
    fetchCount++;
    return new Response('', { status: 404 });
  }) as typeof fetch;

  const lookup = new TraktHtmlLookup();
  await lookup.getEpisodeReleaseDate('tt0000002', 1, 1);
  await lookup.getEpisodeReleaseDate('tt0000002', 1, 1);

  assert.equal(fetchCount, 1);
});

// ---------------------------------------------------------------------------
// TraktApiLookup — API shape + caching
// ---------------------------------------------------------------------------

test('TraktApiLookup resolves movie release date from Trakt API', async () => {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/search/imdb/tt0468569')) {
      return new Response(
        JSON.stringify([{ type: 'movie', movie: { released: '2008-07-18', ids: {} } }]),
        { status: 200 }
      );
    }
    return new Response('[]', { status: 200 });
  }) as typeof fetch;

  const lookup = new TraktApiLookup('test-client-id');
  const date = await lookup.getMovieReleaseDate('tt0468569');
  assert.equal(date, '2008-07-18');
});

test('TraktApiLookup returns undefined when movie not found on Trakt', async () => {
  globalThis.fetch = (async (_input: RequestInfo | URL) => {
    return new Response('[]', { status: 200 });
  }) as typeof fetch;

  const lookup = new TraktApiLookup('test-client-id');
  const date = await lookup.getMovieReleaseDate('tt9999999');
  assert.equal(date, undefined);
});

test('TraktApiLookup caches movie not-found result so API is not re-called', async () => {
  let callCount = 0;
  globalThis.fetch = (async (_input: RequestInfo | URL) => {
    callCount++;
    return new Response('[]', { status: 200 });
  }) as typeof fetch;

  const lookup = new TraktApiLookup('test-client-id');
  await lookup.getMovieReleaseDate('tt9999998');
  await lookup.getMovieReleaseDate('tt9999998');

  assert.equal(callCount, 1);
});

test('TraktApiLookup resolves episode first_aired via show slug', async () => {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/search/imdb/tt0903747') && url.includes('type=show')) {
      return new Response(
        JSON.stringify([{ type: 'show', show: { ids: { slug: 'breaking-bad' } } }]),
        { status: 200 }
      );
    }
    if (url.includes('/shows/breaking-bad/seasons/1/episodes/1')) {
      return new Response(
        JSON.stringify({ first_aired: '2008-01-20T02:00:00.000Z' }),
        { status: 200 }
      );
    }
    return new Response('[]', { status: 200 });
  }) as typeof fetch;

  const lookup = new TraktApiLookup('test-client-id');
  const date = await lookup.getEpisodeReleaseDate('tt0903747', 1, 1);
  // first_aired UTC ISO sliced to date-only YYYY-MM-DD.
  assert.equal(date, '2008-01-20');
});

test('TraktApiLookup returns undefined for episode when show not found', async () => {
  globalThis.fetch = (async (_input: RequestInfo | URL) => {
    return new Response('[]', { status: 200 });
  }) as typeof fetch;

  const lookup = new TraktApiLookup('test-client-id');
  const date = await lookup.getEpisodeReleaseDate('tt9999997', 1, 1);
  assert.equal(date, undefined);
});

test('TraktApiLookup caches episode not-found result', async () => {
  let callCount = 0;
  globalThis.fetch = (async (_input: RequestInfo | URL) => {
    callCount++;
    return new Response('[]', { status: 200 });
  }) as typeof fetch;

  const lookup = new TraktApiLookup('test-client-id');
  await lookup.getEpisodeReleaseDate('tt9999996', 2, 3);
  await lookup.getEpisodeReleaseDate('tt9999996', 2, 3);

  assert.equal(callCount, 1);
});

test('TraktApiLookup returns undefined gracefully on network error', async () => {
  globalThis.fetch = (async (_input: RequestInfo | URL) => {
    throw new Error('network failure');
  }) as typeof fetch;

  const lookup = new TraktApiLookup('test-client-id');
  const date = await lookup.getMovieReleaseDate('tt0000003');
  assert.equal(date, undefined);
});

test('TraktApiLookup sends correct headers', async () => {
  let capturedHeaders: Record<string, string> = {};
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const rawHeaders = init?.headers;
    if (rawHeaders instanceof Headers) {
      rawHeaders.forEach((v, k) => { capturedHeaders[k.toLowerCase()] = v; });
    } else if (Array.isArray(rawHeaders)) {
      for (const [k, v] of rawHeaders) capturedHeaders[k.toLowerCase()] = v;
    } else if (rawHeaders) {
      for (const [k, v] of Object.entries(rawHeaders as Record<string, string>)) {
        capturedHeaders[k.toLowerCase()] = v;
      }
    }
    return new Response('[]', { status: 200 });
  }) as typeof fetch;

  const lookup = new TraktApiLookup('my-client-id');
  await lookup.getMovieReleaseDate('tt0000004');
  assert.equal(capturedHeaders['trakt-api-key'], 'my-client-id');
  assert.equal(capturedHeaders['trakt-api-version'], '2');
});
