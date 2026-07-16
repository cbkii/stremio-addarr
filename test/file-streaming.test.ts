import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/index.js';
import { buildFileToken } from '../src/lib/file-tokens.js';
import { addonUrl, baseConfig, signedFileUrl, withServer } from './_helpers.js';

const ORIGINAL_FETCH = globalThis.fetch;
const FILE_SECRET = 'test-streaming-secret-32-chars-xx';

test.afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

// ── Feature disabled ──────────────────────────────────────────────────────────

test('file route returns 404 when FILE_STREAMING_ENABLED=false', async () => {
  const cfg = baseConfig();
  cfg.fileStreaming.enabled = false;
  const app = createApp(cfg);

  await withServer(app, async (baseUrl) => {
    const res = await ORIGINAL_FETCH(`${addonUrl(baseUrl, cfg)}/files/movie/42?exp=${Math.floor(Date.now() / 1000) + 3600}&t=sometoken`);
    assert.equal(res.status, 404);
  });
});

// ── Bad requests ──────────────────────────────────────────────────────────────

test('file route returns 400 for unsupported kind', async () => {
  const cfg = baseConfig();
  cfg.fileStreaming.enabled = true;
  cfg.fileStreaming.secret = FILE_SECRET;
  const app = createApp(cfg);

  const token = buildFileToken(FILE_SECRET, 'movie', 42);
  await withServer(app, async (baseUrl) => {
    const res = await ORIGINAL_FETCH(`${addonUrl(baseUrl, cfg)}/files/unknown/42?exp=${Math.floor(Date.now() / 1000) + 3600}&t=${token}`);
    assert.equal(res.status, 400);
  });
});

test('file route returns 400 for non-integer fileId', async () => {
  const cfg = baseConfig();
  cfg.fileStreaming.enabled = true;
  cfg.fileStreaming.secret = FILE_SECRET;
  const app = createApp(cfg);

  await withServer(app, async (baseUrl) => {
    const res = await ORIGINAL_FETCH(`${addonUrl(baseUrl, cfg)}/files/movie/abc?exp=${Math.floor(Date.now() / 1000) + 3600}&t=sometoken`);
    assert.equal(res.status, 400);
  });
});

test('file route returns 400 for zero fileId', async () => {
  const cfg = baseConfig();
  cfg.fileStreaming.enabled = true;
  cfg.fileStreaming.secret = FILE_SECRET;
  const app = createApp(cfg);

  await withServer(app, async (baseUrl) => {
    const res = await ORIGINAL_FETCH(`${addonUrl(baseUrl, cfg)}/files/movie/0?exp=${Math.floor(Date.now() / 1000) + 3600}&t=sometoken`);
    assert.equal(res.status, 400);
  });
});

// ── Auth ──────────────────────────────────────────────────────────────────────

test('file route returns 403 for missing token', async () => {
  const cfg = baseConfig();
  cfg.fileStreaming.enabled = true;
  cfg.fileStreaming.secret = FILE_SECRET;
  const app = createApp(cfg);

  await withServer(app, async (baseUrl) => {
    const res = await ORIGINAL_FETCH(`${addonUrl(baseUrl, cfg)}/files/movie/42?exp=${Math.floor(Date.now() / 1000) + 3600}`);
    assert.equal(res.status, 403);
  });
});

test('file route returns 403 for wrong token', async () => {
  const cfg = baseConfig();
  cfg.fileStreaming.enabled = true;
  cfg.fileStreaming.secret = FILE_SECRET;
  const app = createApp(cfg);

  const correctToken = buildFileToken(FILE_SECRET, 'movie', 42);
  const wrongToken = correctToken.replace(/.$/, correctToken.endsWith('0') ? '1' : '0');
  await withServer(app, async (baseUrl) => {
    const res = await ORIGINAL_FETCH(signedFileUrl(baseUrl, cfg, 'movie', 42, { token: wrongToken }));
    assert.equal(res.status, 403);
  });
});

test('file route returns 403 for token from different fileId', async () => {
  const cfg = baseConfig();
  cfg.fileStreaming.enabled = true;
  cfg.fileStreaming.secret = FILE_SECRET;
  const app = createApp(cfg);

  const tokenFor99 = buildFileToken(FILE_SECRET, 'movie', 99);
  await withServer(app, async (baseUrl) => {
    const res = await ORIGINAL_FETCH(signedFileUrl(baseUrl, cfg, 'movie', 42, { tokenFileId: 99 }));
    assert.equal(res.status, 403);
  });
});

// ── Path not found ────────────────────────────────────────────────────────────

test('file route returns 404 when Arr API returns null path', async () => {
  const cfg = baseConfig();
  cfg.fileStreaming.enabled = true;
  cfg.fileStreaming.secret = FILE_SECRET;
  cfg.radarr.enabled = true;

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const urlPath = new URL(String(input)).pathname;
    if (urlPath === '/api/v3/moviefile/42') return new Response('{}', { status: 200 }); // no 'path' field
    return new Response('[]', { status: 200 });
  }) as typeof fetch;

  const app = createApp(cfg);
  const token = buildFileToken(FILE_SECRET, 'movie', 42);
  await withServer(app, async (baseUrl) => {
    const res = await ORIGINAL_FETCH(signedFileUrl(baseUrl, cfg, 'movie', 42));
    assert.equal(res.status, 404);
  });
});

test('file route returns 404 when Arr API returns HTTP error', async () => {
  const cfg = baseConfig();
  cfg.fileStreaming.enabled = true;
  cfg.fileStreaming.secret = FILE_SECRET;
  cfg.radarr.enabled = true;

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const urlPath = new URL(String(input)).pathname;
    if (urlPath === '/api/v3/moviefile/99') return new Response('not found', { status: 404 });
    return new Response('[]', { status: 200 });
  }) as typeof fetch;

  const app = createApp(cfg);
  const token = buildFileToken(FILE_SECRET, 'movie', 99);
  await withServer(app, async (baseUrl) => {
    const res = await ORIGINAL_FETCH(signedFileUrl(baseUrl, cfg, 'movie', 99));
    assert.equal(res.status, 404);
  });
});

// ── Path traversal protection ─────────────────────────────────────────────────

test('file route returns 403 when Arr returns path outside root folder', async () => {
  const tmpDir = os.tmpdir();
  const cfg = baseConfig();
  cfg.fileStreaming.enabled = true;
  cfg.fileStreaming.secret = FILE_SECRET;
  cfg.radarr.enabled = true;
  cfg.radarr.rootFolderPath = path.join(tmpDir, 'movies');
  fs.mkdirSync(cfg.radarr.rootFolderPath, { recursive: true });

  // Arr API returns a path outside the configured root folder
  const evilPath = path.join(tmpDir, 'secret', 'passwords.txt');
  fs.mkdirSync(path.dirname(evilPath), { recursive: true });
  fs.writeFileSync(evilPath, 'sensitive');
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const urlPath = new URL(String(input)).pathname;
    if (urlPath === '/api/v3/moviefile/7') {
      return new Response(JSON.stringify({ path: evilPath }), { status: 200 });
    }
    return new Response('[]', { status: 200 });
  }) as typeof fetch;

  const app = createApp(cfg);
  const token = buildFileToken(FILE_SECRET, 'movie', 7);
  await withServer(app, async (baseUrl) => {
    const res = await ORIGINAL_FETCH(signedFileUrl(baseUrl, cfg, 'movie', 7));
    assert.equal(res.status, 403);
  });
});

test('file route allows canonicalized path when configured root is a symlink (false 403 regression)', async () => {
  const rootParent = fs.mkdtempSync(path.join(os.tmpdir(), 'addarr-root-parent-'));
  const realRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'addarr-real-root-'));
  const symlinkRoot = path.join(rootParent, 'movies-link');
  const realFile = path.join(realRoot, 'movie.mp4');
  fs.writeFileSync(realFile, 'canonical-content');
  fs.symlinkSync(realRoot, symlinkRoot, 'dir');

  try {
    const cfg = baseConfig();
    cfg.fileStreaming.enabled = true;
    cfg.fileStreaming.secret = FILE_SECRET;
    cfg.radarr.enabled = true;
    cfg.radarr.rootFolderPath = symlinkRoot;

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const urlPath = new URL(String(input)).pathname;
      if (urlPath === '/api/v3/moviefile/88') {
        return new Response(JSON.stringify({ path: realFile }), { status: 200 });
      }
      return new Response('[]', { status: 200 });
    }) as typeof fetch;

    const app = createApp(cfg);
    const token = buildFileToken(FILE_SECRET, 'movie', 88);
    await withServer(app, async (baseUrl) => {
      const res = await ORIGINAL_FETCH(signedFileUrl(baseUrl, cfg, 'movie', 88));
      assert.equal(res.status, 200);
      assert.equal(await res.text(), 'canonical-content');
    });
  } finally {
    fs.rmSync(rootParent, { recursive: true, force: true });
    fs.rmSync(realRoot, { recursive: true, force: true });
    globalThis.fetch = ORIGINAL_FETCH;
  }
});

test('file route rejects symlink escape outside configured root', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'addarr-root-'));
  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'addarr-outside-'));
  const outsideFile = path.join(outsideDir, 'secret.mp4');
  const linkedFile = path.join(root, 'linked.mp4');
  fs.writeFileSync(outsideFile, 'not-allowed');
  fs.symlinkSync(outsideFile, linkedFile, 'file');

  try {
    const cfg = baseConfig();
    cfg.fileStreaming.enabled = true;
    cfg.fileStreaming.secret = FILE_SECRET;
    cfg.radarr.enabled = true;
    cfg.radarr.rootFolderPath = root;

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const urlPath = new URL(String(input)).pathname;
      if (urlPath === '/api/v3/moviefile/89') {
        return new Response(JSON.stringify({ path: linkedFile }), { status: 200 });
      }
      return new Response('[]', { status: 200 });
    }) as typeof fetch;

    const app = createApp(cfg);
    const token = buildFileToken(FILE_SECRET, 'movie', 89);
    await withServer(app, async (baseUrl) => {
      const res = await ORIGINAL_FETCH(signedFileUrl(baseUrl, cfg, 'movie', 89));
      assert.equal(res.status, 403);
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outsideDir, { recursive: true, force: true });
    globalThis.fetch = ORIGINAL_FETCH;
  }
});

// ── Happy path: file is served ────────────────────────────────────────────────

test('file route serves movie file for valid request', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'addarr-test-'));
  const tmpFile = path.join(tmpDir, 'movie.mp4');
  fs.writeFileSync(tmpFile, 'fake-video-content');

  try {
    const cfg = baseConfig();
    cfg.fileStreaming.enabled = true;
    cfg.fileStreaming.secret = FILE_SECRET;
    cfg.radarr.enabled = true;
    cfg.radarr.rootFolderPath = tmpDir;

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const urlPath = new URL(String(input)).pathname;
      if (urlPath === '/api/v3/moviefile/42') {
        return new Response(JSON.stringify({ path: tmpFile }), { status: 200 });
      }
      return new Response('[]', { status: 200 });
    }) as typeof fetch;

    const app = createApp(cfg);
    const token = buildFileToken(FILE_SECRET, 'movie', 42);
    await withServer(app, async (baseUrl) => {
      const res = await ORIGINAL_FETCH(signedFileUrl(baseUrl, cfg, 'movie', 42));
      assert.equal(res.status, 200);
      const body = await res.text();
      assert.equal(body, 'fake-video-content');
    });
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    globalThis.fetch = ORIGINAL_FETCH;
  }
});

test('file route serves episode file for valid series request', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'addarr-test-'));
  const tmpFile = path.join(tmpDir, 'episode.mkv');
  fs.writeFileSync(tmpFile, 'fake-episode-content');

  try {
    const cfg = baseConfig();
    cfg.fileStreaming.enabled = true;
    cfg.fileStreaming.secret = FILE_SECRET;
    cfg.sonarr.enabled = true;
    cfg.sonarr.rootFolderPath = tmpDir;

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const urlPath = new URL(String(input)).pathname;
      if (urlPath === '/api/v3/episodefile/55') {
        return new Response(JSON.stringify({ path: tmpFile }), { status: 200 });
      }
      return new Response('[]', { status: 200 });
    }) as typeof fetch;

    const app = createApp(cfg);
    const token = buildFileToken(FILE_SECRET, 'series', 55);
    await withServer(app, async (baseUrl) => {
      const res = await ORIGINAL_FETCH(signedFileUrl(baseUrl, cfg, 'series', 55));
      assert.equal(res.status, 200);
      const body = await res.text();
      assert.equal(body, 'fake-episode-content');
    });
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    globalThis.fetch = ORIGINAL_FETCH;
  }
});

// ── CORS headers ──────────────────────────────────────────────────────────────

test('file route includes CORS header for cross-origin Stremio access', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'addarr-test-'));
  const tmpFile = path.join(tmpDir, 'movie.mp4');
  fs.writeFileSync(tmpFile, 'data');

  try {
    const cfg = baseConfig();
    cfg.fileStreaming.enabled = true;
    cfg.fileStreaming.secret = FILE_SECRET;
    cfg.radarr.enabled = true;
    cfg.radarr.rootFolderPath = tmpDir;

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const urlPath = new URL(String(input)).pathname;
      if (urlPath === '/api/v3/moviefile/1') {
        return new Response(JSON.stringify({ path: tmpFile }), { status: 200 });
      }
      return new Response('[]', { status: 200 });
    }) as typeof fetch;

    const app = createApp(cfg);
    const token = buildFileToken(FILE_SECRET, 'movie', 1);
    await withServer(app, async (baseUrl) => {
      const res = await ORIGINAL_FETCH(signedFileUrl(baseUrl, cfg, 'movie', 1));
      assert.equal(res.headers.get('access-control-allow-origin'), '*');
    });
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    globalThis.fetch = ORIGINAL_FETCH;
  }
});

test('file route supports HTTP range requests for large video seeking', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'addarr-test-'));
  const tmpFile = path.join(tmpDir, 'movie.mp4');
  fs.writeFileSync(tmpFile, '0123456789');

  try {
    const cfg = baseConfig();
    cfg.fileStreaming.enabled = true;
    cfg.fileStreaming.secret = FILE_SECRET;
    cfg.radarr.enabled = true;
    cfg.radarr.rootFolderPath = tmpDir;

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const urlPath = new URL(String(input)).pathname;
      if (urlPath === '/api/v3/moviefile/3') {
        return new Response(JSON.stringify({ path: tmpFile }), { status: 200 });
      }
      return new Response('[]', { status: 200 });
    }) as typeof fetch;

    const app = createApp(cfg);
    const token = buildFileToken(FILE_SECRET, 'movie', 3);
    await withServer(app, async (baseUrl) => {
      const res = await ORIGINAL_FETCH(signedFileUrl(baseUrl, cfg, 'movie', 3), {
        headers: { Range: 'bytes=0-3' }
      });
      assert.equal(res.status, 206);
      assert.equal(res.headers.get('accept-ranges'), 'bytes');
      assert.equal(res.headers.get('content-range'), 'bytes 0-3/10');
      const body = await res.text();
      assert.equal(body, '0123');
    });
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    globalThis.fetch = ORIGINAL_FETCH;
  }
});

// ── Rate limiting ─────────────────────────────────────────────────────────────

test('file route returns 429 after exceeding rate limit', async () => {
  const cfg = baseConfig();
  cfg.fileStreaming.enabled = true;
  cfg.fileStreaming.secret = FILE_SECRET;
  cfg.radarr.enabled = true;

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const urlPath = new URL(String(input)).pathname;
    if (urlPath.startsWith('/api/v3/moviefile/')) return new Response('{}', { status: 200 });
    return new Response('[]', { status: 200 });
  }) as typeof fetch;

  const app = createApp(cfg);
  const token = buildFileToken(FILE_SECRET, 'movie', 5);

  await withServer(app, async (baseUrl) => {
    // Send 121 requests — the 121st should be rate-limited (limit is 120/min).
    let lastStatus = 0;
    for (let i = 0; i <= 120; i++) {
      const res = await ORIGINAL_FETCH(signedFileUrl(baseUrl, cfg, 'movie', 5));
      lastStatus = res.status;
    }
    assert.equal(lastStatus, 429, 'should return 429 after limit is exceeded');
  });
});

test('file route rate limiting is keyed by forwarded client IP behind trusted loopback proxy', async () => {
  const cfg = baseConfig();
  cfg.fileStreaming.enabled = true;
  cfg.fileStreaming.secret = FILE_SECRET;
  cfg.radarr.enabled = true;

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const urlPath = new URL(String(input)).pathname;
    if (urlPath.startsWith('/api/v3/moviefile/')) return new Response('{}', { status: 200 });
    return new Response('[]', { status: 200 });
  }) as typeof fetch;

  const app = createApp(cfg);
  const token = buildFileToken(FILE_SECRET, 'movie', 5);

  await withServer(app, async (baseUrl) => {
    let statusIp1 = 0;
    for (let i = 0; i <= 120; i++) {
      const res = await ORIGINAL_FETCH(signedFileUrl(baseUrl, cfg, 'movie', 5), {
        headers: { 'X-Forwarded-For': '203.0.113.1' }
      });
      statusIp1 = res.status;
    }
    assert.equal(statusIp1, 429, 'first forwarded client should be rate limited');

    const resIp2 = await ORIGINAL_FETCH(signedFileUrl(baseUrl, cfg, 'movie', 5), {
      headers: { 'X-Forwarded-For': '203.0.113.2' }
    });
    assert.notEqual(resIp2.status, 429, 'different forwarded client should not share same limiter bucket');
  });
});
