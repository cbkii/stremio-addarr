import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/index.js';
import { baseConfig, withServer } from './_helpers.js';

const ORIGINAL_FETCH = globalThis.fetch;

test.afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

test('manifest endpoint shape sanity', async () => {
  const app = createApp(baseConfig());
  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/manifest.json`);
    assert.equal(response.status, 200);
    const manifest = (await response.json()) as {
      resources: string[];
      types: string[];
      idPrefixes: string[];
      logo: string;
    };
    assert.deepEqual(manifest.resources, ['stream', 'catalog']);
    assert.deepEqual(manifest.types, ['movie', 'series']);
    assert.deepEqual(manifest.idPrefixes, ['tt']);
    assert.equal(manifest.logo, 'http://127.0.0.1:7010/assets/logo.png?v=0.1.0-test');
  });
});

test('manifest omits logo when manifestLogoUrl is blank', async () => {
  const cfg = baseConfig();
  cfg.manifestLogoUrl = '';
  const app = createApp(cfg);
  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/manifest.json`);
    assert.equal(response.status, 200);
    const manifest = (await response.json()) as { logo?: string };
    assert.equal(manifest.logo, undefined);
  });
});

test('catalog handler returns rows for radarr-recent and sonarr-recent', async () => {
  const cfg = baseConfig();
  cfg.radarr.enabled = true;
  cfg.sonarr.enabled = true;

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const parsed = new URL(String(input));
    const path = parsed.pathname + parsed.search;
    if (parsed.hostname.includes('radarr')) {
      if (path === '/api/v3/movie') return new Response('[{"id":1,"title":"Movie A","imdbId":"tt100"}]', { status: 200 });
      if (path.startsWith('/api/v3/queue/details')) return new Response('[]', { status: 200 });
      if (path.startsWith('/api/v3/history')) return new Response('{"records":[{"movieId":1,"date":"2026-04-07T00:00:00Z"}]}', { status: 200 });
    }
    if (parsed.hostname.includes('sonarr')) {
      if (path === '/api/v3/series') return new Response('[{"id":2,"title":"Show A","imdbId":"tt200"}]', { status: 200 });
      if (path.startsWith('/api/v3/queue/details')) return new Response('[]', { status: 200 });
      if (path.startsWith('/api/v3/history')) return new Response('{"records":[{"seriesId":2,"date":"2026-04-07T00:00:00Z","episode":{"seasonNumber":2,"episodeNumber":4}}]}', { status: 200 });
    }
    if (path.startsWith('/api/v3/queue')) return new Response('[]', { status: 200 });
    if (path === '/api/v3/system/status') return new Response('{}', { status: 200 });
    return new Response('{}', { status: 200 });
  }) as typeof fetch;

  const app = createApp(cfg);
  await withServer(app, async (baseUrl) => {
    const movieRes = await ORIGINAL_FETCH(`${baseUrl}/catalog/movie/radarr-recent.json`);
    const movieBody = (await movieRes.json()) as { metas: Array<{ id: string }> };
    assert.equal(movieRes.status, 200);
    assert.equal(movieBody.metas[0]?.id, 'tt100');

    const seriesRes = await ORIGINAL_FETCH(`${baseUrl}/catalog/series/sonarr-recent.json`);
    const seriesBody = (await seriesRes.json()) as { metas: Array<{ id: string }> };
    assert.equal(seriesRes.status, 200);
    assert.equal(seriesBody.metas[0]?.id, 'tt200');
  });
});

test('catalog cache hints are driven by config values', async () => {
  const cfg = baseConfig();
  cfg.catalogCacheMaxAgeSec = 9;
  cfg.catalogStaleRevalidateSec = 33;
  cfg.catalogStaleErrorSec = 77;

  const app = createApp(cfg);
  await withServer(app, async (baseUrl) => {
    const response = await ORIGINAL_FETCH(`${baseUrl}/catalog/movie/radarr-recent.json`);
    const body = (await response.json()) as { cacheMaxAge: number; staleRevalidate: number; staleError: number };
    assert.equal(response.status, 200);
    assert.equal(body.cacheMaxAge, 9);
    assert.equal(body.staleRevalidate, 33);
    assert.equal(body.staleError, 77);
  });
});

test('catalog handler returns empty metas when endpoint type does not match catalog type', async () => {
  const app = createApp(baseConfig());
  await withServer(app, async (baseUrl) => {
    const response = await ORIGINAL_FETCH(`${baseUrl}/catalog/series/radarr-recent.json`);
    const body = (await response.json()) as { metas: unknown[] };
    assert.equal(response.status, 200);
    assert.deepEqual(body.metas, []);
  });
});

test('catalog route includes CORS headers', async () => {
  const app = createApp(baseConfig());
  await withServer(app, async (baseUrl) => {
    const response = await ORIGINAL_FETCH(`${baseUrl}/catalog/movie/radarr-recent.json`);
    assert.equal(response.headers.get('access-control-allow-origin'), '*');
  });
});

test('catalog handler degrades to empty metas when Arr services throw', async () => {
  const cfg = baseConfig();
  cfg.radarr.enabled = true;

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const parsed = new URL(String(input));
    if (parsed.hostname.includes('radarr')) {
      throw new Error('radarr unreachable');
    }
    return new Response('{}', { status: 200 });
  }) as typeof fetch;

  const app = createApp(cfg);
  await withServer(app, async (baseUrl) => {
    const response = await ORIGINAL_FETCH(`${baseUrl}/catalog/movie/radarr-recent.json`);
    const body = (await response.json()) as { metas: unknown[] };
    assert.equal(response.status, 200);
    assert.deepEqual(body.metas, []);
  });
});

test('downloaded tile launches Kodi via externalUrl when enabled', async () => {
  const cfg = baseConfig();
  cfg.radarr.enabled = true;
  cfg.kodi.enabled = true;

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const path = new URL(String(input)).pathname + new URL(String(input)).search;
    if (path === '/api/v3/system/status') return new Response('{}', { status: 200 });
    if (path === '/api/v3/movie') return new Response('[{"id":9,"imdbId":"tt1234567","title":"Mock Movie","year":2020,"digitalRelease":"2020-02-03T00:00:00Z","hasFile":true,"monitored":true}]', { status: 200 });
    return new Response('{}', { status: 200 });
  }) as typeof fetch;

  const app = createApp(cfg);
  await withServer(app, async (baseUrl) => {
    const response = await ORIGINAL_FETCH(`${baseUrl}/stream/movie/tt1234567.json`);
    const body = (await response.json()) as { streams: Array<{ name: string; description?: string; externalUrl?: string }> };
    assert.equal(body.streams[0].name, '✅\nFile\nReady');
    assert.ok(body.streams[0].description?.startsWith('🆕  UNWATCHED'));
    assert.ok(body.streams[0].description?.includes('Mock Movie'), 'description should include matched title');
    assert.match(body.streams[0].description ?? '', /\(03 Feb 20\)/, 'description should include formatted release date');
    assert.match(body.streams[0].externalUrl ?? '', /package=org.xbmc.kodi/);
  });
});

test('downloaded tile has no externalUrl when Kodi is disabled', async () => {
  const cfg = baseConfig();
  cfg.kodi.enabled = false;
  cfg.radarr.enabled = true;

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const path = new URL(String(input)).pathname;
    if (path === '/api/v3/system/status') return new Response('{}', { status: 200 });
    if (path === '/api/v3/movie') return new Response('[{"id":9,"imdbId":"tt1234567","hasFile":true,"monitored":true}]', { status: 200 });
    return new Response('{}', { status: 200 });
  }) as typeof fetch;

  const app = createApp(cfg);
  await withServer(app, async (baseUrl) => {
    const response = await ORIGINAL_FETCH(`${baseUrl}/stream/movie/tt1234567.json`);
    const body = (await response.json()) as { streams: Array<{ externalUrl?: string }> };
    assert.equal(body.streams[0].externalUrl ? 1 : 0, 0);
  });
});

test('missing movie tile triggers search action URL and does not expose secrets', async () => {
  const cfg = baseConfig();
  cfg.radarr.enabled = true;
  cfg.publicBaseUrl = 'https://stremio-addarr.lan';

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const parsed = new URL(String(input));
    const path = parsed.pathname + parsed.search;
    if (path === '/api/v3/system/status') return new Response('{}', { status: 200 });
    if (path === '/api/v3/movie') return new Response('[{"id":9,"imdbId":"tt1234567","title":"Mock Movie","year":2020,"physicalRelease":"2020-03-07","hasFile":false,"monitored":true}]', { status: 200 });
    if (path.startsWith('/api/v3/queue?')) return new Response('{"records":[]}', { status: 200 });
    return new Response('{}', { status: 200 });
  }) as typeof fetch;

  const app = createApp(cfg);
  await withServer(app, async (baseUrl) => {
    const response = await ORIGINAL_FETCH(`${baseUrl}/stream/movie/tt1234567.json`);
    const body = (await response.json()) as { streams: Array<{ name: string; description?: string; url?: string; behaviorHints?: { notWebReady?: boolean } }> };
    assert.equal(body.streams[0].name, '🔍🦜\nSearch\n+ DL');
    assert.ok(body.streams[0].description?.startsWith('🆕  UNWATCHED'));
    assert.ok(body.streams[0].description?.includes('📲 🔗  192.168.1.50:7878'));
    assert.equal(body.streams[0].url, 'https://stremio-addarr.lan/action/search/movie/tt1234567');
    assert.equal(body.streams[0].behaviorHints?.notWebReady, true, 'Action tiles must set notWebReady to prevent watched tracking');
    assert.ok(body.streams[0].description?.includes('Mock Movie'), 'description should include matched title');
    assert.match(body.streams[0].description ?? '', /\(07 Mar 20\)/, 'description should include formatted release date');

    const serialized = JSON.stringify(body);
    assert.ok(!serialized.includes('radarr-key'));
    assert.ok(!serialized.includes('sonarr-key'));
  });
});

test('missing episode tile generates encoded Sonarr search action URL', async () => {
  const cfg = baseConfig();
  cfg.sonarr.enabled = true;
  cfg.publicBaseUrl = 'https://stremio-addarr.lan';

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const parsed = new URL(String(input));
    const path = parsed.pathname + parsed.search;
    if (path === '/api/v3/system/status') return new Response('{}', { status: 200 });
    if (path === '/api/v3/series') return new Response('[{"id":10,"imdbId":"tt7654321","title":"Mock Show"}]', { status: 200 });
    if (path.startsWith('/api/v3/episode?seriesId=10')) {
      return new Response('[{"id":42,"seasonNumber":2,"episodeNumber":5,"monitored":true,"hasFile":false}]', { status: 200 });
    }
    if (path.startsWith('/api/v3/queue?')) return new Response('{"records":[]}', { status: 200 });
    return new Response('{}', { status: 200 });
  }) as typeof fetch;

  const app = createApp(cfg);
  await withServer(app, async (baseUrl) => {
    const response = await ORIGINAL_FETCH(`${baseUrl}/stream/series/tt7654321%3A2%3A5.json`);
    const body = (await response.json()) as { streams: Array<{ name: string; description?: string; url?: string; behaviorHints?: { notWebReady?: boolean } }> };
    assert.equal(body.streams[0].name, '🔍🦜\nSearch\n+ DL');
    assert.ok(body.streams[0].description?.includes('📲 🔗  192.168.1.50:8989'));
    assert.equal(body.streams[0].url, 'https://stremio-addarr.lan/action/search/series/tt7654321%3A2%3A5');
    assert.equal(body.streams[0].behaviorHints?.notWebReady, true);
    assert.ok(body.streams[0].description?.includes('S02E05'), 'description should include episode label');
  });
});

test('movie line uses in-cinemas date only when release dates are unavailable', async () => {
  const cfg = baseConfig();
  cfg.radarr.enabled = true;

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const parsed = new URL(String(input));
    const path = parsed.pathname + parsed.search;
    if (path === '/api/v3/system/status') return new Response('{}', { status: 200 });
    if (path === '/api/v3/movie') {
      return new Response('[{"id":9,"imdbId":"tt1234567","title":"Fallback Movie","inCinemas":"2021-09-11T00:00:00Z","hasFile":false,"monitored":true}]', { status: 200 });
    }
    if (path.startsWith('/api/v3/queue?')) return new Response('{"records":[]}', { status: 200 });
    return new Response('{}', { status: 200 });
  }) as typeof fetch;

  const app = createApp(cfg);
  await withServer(app, async (baseUrl) => {
    const response = await ORIGINAL_FETCH(`${baseUrl}/stream/movie/tt1234567.json`);
    const body = (await response.json()) as { streams: Array<{ description?: string }> };
    assert.match(body.streams[0].description ?? '', /\(11 Sep[a-z]* 21\)/i, 'expected in-cinemas fallback formatted date');
  });
});

test('episode labels include release date when Sonarr airDateUtc exists', async () => {
  const cfg = baseConfig();
  cfg.sonarr.enabled = true;

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const parsed = new URL(String(input));
    const path = parsed.pathname + parsed.search;
    if (path === '/api/v3/system/status') return new Response('{}', { status: 200 });
    if (path === '/api/v3/series') return new Response('[{"id":10,"imdbId":"tt7654321","title":"Mock Show"}]', { status: 200 });
    if (path.startsWith('/api/v3/episode?seriesId=10')) {
      return new Response('[{"id":42,"seasonNumber":2,"episodeNumber":5,"airDateUtc":"2024-01-09T00:00:00Z","monitored":true,"hasFile":false}]', { status: 200 });
    }
    if (path.startsWith('/api/v3/queue?')) return new Response('{"records":[]}', { status: 200 });
    return new Response('{}', { status: 200 });
  }) as typeof fetch;

  const app = createApp(cfg);
  await withServer(app, async (baseUrl) => {
    const response = await ORIGINAL_FETCH(`${baseUrl}/stream/series/tt7654321%3A2%3A5.json`);
    const body = (await response.json()) as { streams: Array<{ description?: string }> };
    assert.ok(body.streams[0].description?.includes('S02E05 (09 Jan 24)'), 'description should include episode release date');
  });
});

test('stream cache hints are driven by config values', async () => {
  const cfg = baseConfig();
  cfg.streamCacheMaxAgeSec = 7;
  cfg.streamStaleRevalidateSec = 11;
  const app = createApp(cfg);

  await withServer(app, async (baseUrl) => {
    const response = await ORIGINAL_FETCH(`${baseUrl}/stream/movie/tt1234567.json`);
    assert.equal(response.status, 200);
    const body = (await response.json()) as { cacheMaxAge: number; staleRevalidate: number };
    assert.equal(body.cacheMaxAge, 7);
    assert.equal(body.staleRevalidate, 11);
  });
});

test('downloaded tile includes playback url and omits Kodi fallback when file streaming is enabled', async () => {
  const cfg = baseConfig();
  cfg.fileStreaming.enabled = true;
  cfg.fileStreaming.secret = 'test-secret-32-chars-long-enough!!';
  cfg.fileStreaming.playbackMode = 'direct';
  cfg.radarr.enabled = true;
  cfg.publicBaseUrl = 'https://pi.example.com';

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const urlPath = new URL(String(input)).pathname;
    if (urlPath === '/api/v3/system/status') return new Response('{}', { status: 200 });
    if (urlPath === '/api/v3/movie') {
      return new Response(
        '[{"id":9,"imdbId":"tt1234567","title":"Test Movie","year":2020,"movieFile":{"id":77,"relativePath":"Test.Movie.2020.mkv","size":3221225472},"monitored":true}]',
        { status: 200 }
      );
    }
    return new Response('{}', { status: 200 });
  }) as typeof fetch;

  const app = createApp(cfg);
  await withServer(app, async (baseUrl) => {
    const response = await ORIGINAL_FETCH(`${baseUrl}/stream/movie/tt1234567.json`);
    const body = (await response.json()) as {
      streams: Array<{
        name: string;
        description?: string;
        url?: string;
        externalUrl?: string;
        behaviorHints?: { notWebReady?: boolean; filename?: string; videoSize?: number };
      }>;
    };
    assert.equal(body.streams[0].name, '✅\nFile\nReady');
    assert.ok(body.streams[0].description?.startsWith('🆕  UNWATCHED'));
    assert.ok(body.streams[0].url?.startsWith('https://pi.example.com/files/movie/77?t='), 'should have a file streaming url');
    assert.equal(body.streams[0].externalUrl ? 1 : 0, 0, 'Kodi fallback must be omitted when direct stream url is present');
    assert.equal(body.streams[0].behaviorHints?.notWebReady, true);
    assert.equal(body.streams[0].behaviorHints?.filename, 'Test.Movie.2020.mkv');
    assert.equal(body.streams[0].behaviorHints?.videoSize, 3221225472);
  });
});

test('downloaded tile has no url when file streaming is disabled', async () => {
  const cfg = baseConfig();
  cfg.fileStreaming.enabled = false;
  cfg.radarr.enabled = true;

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const urlPath = new URL(String(input)).pathname;
    if (urlPath === '/api/v3/system/status') return new Response('{}', { status: 200 });
    if (urlPath === '/api/v3/movie') {
      return new Response(
        '[{"id":9,"imdbId":"tt1234567","title":"Test Movie","year":2020,"movieFile":{"id":77},"monitored":true}]',
        { status: 200 }
      );
    }
    return new Response('{}', { status: 200 });
  }) as typeof fetch;

  const app = createApp(cfg);
  await withServer(app, async (baseUrl) => {
    const response = await ORIGINAL_FETCH(`${baseUrl}/stream/movie/tt1234567.json`);
    const body = (await response.json()) as { streams: Array<{ name: string; description?: string; url?: string }> };
    assert.equal(body.streams[0].name, '✅\nFile\nReady');
    assert.ok(body.streams[0].description?.startsWith('🆕  UNWATCHED'));
    assert.equal(body.streams[0].url, undefined, 'no url when file streaming disabled');
  });
});

test('downloaded tile has no url when movieFile id is absent and keeps Kodi fallback in direct mode', async () => {
  const cfg = baseConfig();
  cfg.fileStreaming.enabled = true;
  cfg.fileStreaming.secret = 'test-secret-32-chars-long-enough!!';
  cfg.fileStreaming.playbackMode = 'direct';
  cfg.radarr.enabled = true;
  cfg.kodi.enabled = true;

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const urlPath = new URL(String(input)).pathname;
    if (urlPath === '/api/v3/system/status') return new Response('{}', { status: 200 });
    // hasFile=true but no movieFile object (older Radarr response format)
    if (urlPath === '/api/v3/movie') {
      return new Response('[{"id":9,"imdbId":"tt1234567","hasFile":true,"monitored":true}]', { status: 200 });
    }
    return new Response('{}', { status: 200 });
  }) as typeof fetch;

  const app = createApp(cfg);
  await withServer(app, async (baseUrl) => {
    const response = await ORIGINAL_FETCH(`${baseUrl}/stream/movie/tt1234567.json`);
    const body = (await response.json()) as { streams: Array<{ url?: string; externalUrl?: string }> };
    assert.equal(body.streams[0].url, undefined, 'no url without movieFile.id');
    assert.match(body.streams[0].externalUrl ?? '', /package=org.xbmc.kodi/, 'Kodi fallback should be preserved');
  });
});

test('episode downloaded tile keeps Kodi fallback in direct mode when episodeFileId is absent', async () => {
  const cfg = baseConfig();
  cfg.fileStreaming.enabled = true;
  cfg.fileStreaming.secret = 'test-secret-32-chars-long-enough!!';
  cfg.fileStreaming.playbackMode = 'direct';
  cfg.sonarr.enabled = true;
  cfg.kodi.enabled = true;

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const parsed = new URL(String(input));
    const urlPath = parsed.pathname;
    if (urlPath === '/api/v3/system/status') return new Response('{}', { status: 200 });
    if (urlPath === '/api/v3/series') return new Response('[{"id":10,"imdbId":"tt9876543","title":"Test Show"}]', { status: 200 });
    if (urlPath === '/api/v3/episode' && parsed.search.includes('seriesId=10')) {
      return new Response('[{"id":5,"seasonNumber":1,"episodeNumber":2,"hasFile":true,"monitored":true}]', { status: 200 });
    }
    if (urlPath.startsWith('/api/v3/queue')) return new Response('{"records":[]}', { status: 200 });
    return new Response('[]', { status: 200 });
  }) as typeof fetch;

  const app = createApp(cfg);
  await withServer(app, async (baseUrl) => {
    const response = await ORIGINAL_FETCH(`${baseUrl}/stream/series/tt9876543%3A1%3A2.json`);
    const body = (await response.json()) as { streams: Array<{ url?: string; externalUrl?: string }> };
    assert.equal(body.streams[0].url, undefined, 'no url without episodeFileId');
    assert.match(body.streams[0].externalUrl ?? '', /package=org.xbmc.kodi/, 'Kodi fallback should be preserved');
  });
});

test('episode downloaded tile includes playback url and omits Kodi fallback when file streaming is enabled', async () => {
  const cfg = baseConfig();
  cfg.fileStreaming.enabled = true;
  cfg.fileStreaming.secret = 'test-secret-32-chars-long-enough!!';
  cfg.fileStreaming.playbackMode = 'direct';
  cfg.sonarr.enabled = true;
  cfg.publicBaseUrl = 'https://pi.example.com';

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const parsed = new URL(String(input));
    const urlPath = parsed.pathname;
    if (urlPath === '/api/v3/system/status') return new Response('{}', { status: 200 });
    if (urlPath === '/api/v3/series') {
      return new Response('[{"id":10,"imdbId":"tt9876543","title":"Test Show"}]', { status: 200 });
    }
    if (urlPath === '/api/v3/episode' && parsed.search.includes('seriesId=10')) {
      return new Response(
        '[{"id":5,"seasonNumber":1,"episodeNumber":2,"episodeFileId":88,"episodeFile":{"relativePath":"Test.Show.S01E02.mkv","size":536870912},"monitored":true}]',
        { status: 200 }
      );
    }
    if (urlPath.startsWith('/api/v3/queue')) return new Response('{"records":[]}', { status: 200 });
    return new Response('[]', { status: 200 });
  }) as typeof fetch;

  const app = createApp(cfg);
  await withServer(app, async (baseUrl) => {
    const response = await ORIGINAL_FETCH(`${baseUrl}/stream/series/tt9876543%3A1%3A2.json`);
    const body = (await response.json()) as {
      streams: Array<{
        name: string;
        url?: string;
        externalUrl?: string;
        behaviorHints?: { notWebReady?: boolean; filename?: string; videoSize?: number };
      }>;
    };
    assert.equal(body.streams[0].name, '✅\nFile\nReady');
    assert.ok(body.streams[0].url?.startsWith('https://pi.example.com/files/series/88?t='), 'should have episode file streaming url');
    assert.equal(body.streams[0].externalUrl ? 1 : 0, 0, 'Kodi fallback must be omitted when direct stream url is present');
    assert.equal(body.streams[0].behaviorHints?.notWebReady, true);
    assert.equal(body.streams[0].behaviorHints?.filename, 'Test.Show.S01E02.mkv');
    assert.equal(body.streams[0].behaviorHints?.videoSize, 536870912);
  });
});

test('downloaded tile uses Kodi only when playback mode is set to kodi', async () => {
  const cfg = baseConfig();
  cfg.fileStreaming.enabled = true;
  cfg.fileStreaming.secret = 'test-secret-32-chars-long-enough!!';
  cfg.fileStreaming.playbackMode = 'kodi';
  cfg.radarr.enabled = true;
  cfg.kodi.enabled = true;

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const urlPath = new URL(String(input)).pathname;
    if (urlPath === '/api/v3/system/status') return new Response('{}', { status: 200 });
    if (urlPath === '/api/v3/movie') {
      return new Response(
        '[{"id":9,"imdbId":"tt1234567","title":"Test Movie","year":2020,"movieFile":{"id":77},"monitored":true}]',
        { status: 200 }
      );
    }
    return new Response('{}', { status: 200 });
  }) as typeof fetch;

  const app = createApp(cfg);
  await withServer(app, async (baseUrl) => {
    const response = await ORIGINAL_FETCH(`${baseUrl}/stream/movie/tt1234567.json`);
    const body = (await response.json()) as { streams: Array<{ url?: string; externalUrl?: string }> };
    assert.equal(body.streams[0].url, undefined);
    assert.match(body.streams[0].externalUrl ?? '', /package=org.xbmc.kodi/);
  });
});
