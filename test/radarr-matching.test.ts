import test from 'node:test';
import assert from 'node:assert/strict';
import { RadarrClient } from '../src/services/radarr.js';
import { baseConfig } from './_helpers.js';

const ORIGINAL_FETCH = globalThis.fetch;

test.afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

test('Radarr matching: Exact IMDb match succeeds from array', async () => {
  const cfg = baseConfig();
  cfg.radarr.enabled = true;
  let capturedBody: any;
  const http = {
    async get(path: string) {
      if (path === '/api/v3/movie') return [];
      if (path.startsWith('/api/v3/queue')) return { records: [] };
      if (path.startsWith('/api/v3/movie/lookup')) {
        return [
          { imdbId: 'ttWRONG', title: 'Wrong', tmdbId: 1 },
          { imdbId: 'tt123', title: 'Correct', tmdbId: 2 }
        ];
      }
      return [];
    },
    async post(path: string, body: any) { capturedBody = body; }
  };
  const client = new RadarrClient(cfg, http as any);
  const res = await client.addMovieByImdbId('tt123');
  assert.equal(res.ok, true);
  assert.equal(capturedBody?.tmdbId, 2);
});

test('Radarr matching: No exact match and strict mode returns ok: false', async () => {
  const cfg = baseConfig();
  cfg.radarr.enabled = true;
  cfg.radarr.strictImdbMatch = true;
  const http = {
    async get(path: string) {
      if (path === '/api/v3/movie') return [];
      if (path.startsWith('/api/v3/queue')) return { records: [] };
      if (path.startsWith('/api/v3/movie/lookup')) {
        return [{ imdbId: 'ttWRONG', title: 'Wrong', tmdbId: 1 }];
      }
      return [];
    },
    async post() { throw new Error('should not post'); }
  };
  const client = new RadarrClient(cfg, http as any);
  const res = await client.addMovieByImdbId('tt123');
  assert.equal(res.ok, false);
});

test('Radarr matching: TMDB cross-check accepts candidate when requested IMDb resolves to same TMDB ID', async () => {
  const cfg = baseConfig();
  cfg.radarr.enabled = true;
  let capturedBody: any;
  const http = {
    async get(path: string) {
      if (path === '/api/v3/movie') return [];
      if (path.startsWith('/api/v3/queue')) return { records: [] };
      if (path.startsWith('/api/v3/movie/lookup')) {
        return [{ imdbId: 'ttWRONG', title: 'Mismatch', tmdbId: 999 }];
      }
      return [];
    },
    async post(path: string, body: any) { capturedBody = body; }
  };
  const tmdbLookup = {
    async getMovieTmdbId(imdbId: string) {
      if (imdbId === 'tt123') return 999;
      return undefined;
    },
    async getMovieReleaseDate() { return undefined; },
    async getEpisodeReleaseDate() { return undefined; }
  };
  const client = new RadarrClient(cfg, http as any, tmdbLookup as any);
  const res = await client.addMovieByImdbId('tt123');
  assert.equal(res.ok, true);
  assert.equal(capturedBody?.tmdbId, 999);
});

test('Radarr matching: title+year fallback succeeds when strict mode is false', async () => {
  const cfg = baseConfig();
  cfg.radarr.enabled = true;
  cfg.radarr.strictImdbMatch = false;
  let capturedBody: any;
  const http = {
    async get(path: string) {
      if (path === '/api/v3/movie') return [];
      if (path.startsWith('/api/v3/queue')) return { records: [] };
      if (path.startsWith('/api/v3/movie/lookup')) {
        return [{ imdbId: 'ttWRONG', title: 'The Matrix: Reloaded', year: 2003, tmdbId: 777 }];
      }
      return [];
    },
    async post(path: string, body: any) { capturedBody = body; }
  };

  globalThis.fetch = async (url: string | URL | Request) => {
    if (url.toString().includes('tt123')) {
      return {
        ok: true,
        json: async () => ({ meta: { name: 'The Matrix Reloaded', year: '2003' } })
      } as any;
    }
    return { ok: false } as any;
  };

  const client = new RadarrClient(cfg, http as any);
  const res = await client.addMovieByImdbId('tt123');
  assert.equal(res.ok, true);
  assert.equal(capturedBody?.tmdbId, 777);
});

test('Radarr matching: title+year fallback rejects similar title with different year', async () => {
  const cfg = baseConfig();
  cfg.radarr.enabled = true;
  cfg.radarr.strictImdbMatch = false;
  const http = {
    async get(path: string) {
      if (path === '/api/v3/movie') return [];
      if (path.startsWith('/api/v3/queue')) return { records: [] };
      if (path.startsWith('/api/v3/movie/lookup')) {
        return [{ imdbId: 'ttWRONG', title: 'The Matrix', year: 2000, tmdbId: 777 }];
      }
      return [];
    },
    async post() { throw new Error('should not post'); }
  };
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ meta: { name: 'The Matrix', year: '1999' } }) }) as any;

  const client = new RadarrClient(cfg, http as any);
  const res = await client.addMovieByImdbId('tt123');
  assert.equal(res.ok, false);
});
