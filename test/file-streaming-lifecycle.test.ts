import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/index.js';
import { buildFileToken } from '../src/lib/file-tokens.js';
import { baseConfig, signedFileUrl, withServer } from './_helpers.js';

const ORIGINAL_FETCH = globalThis.fetch;
const FILE_SECRET = 'test-streaming-secret-32-chars-xx';

test.afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

async function withMovieFile(run: (ctx: {
  baseUrl: string;
  cfg: ReturnType<typeof baseConfig>;
  getArrCalls: () => number;
}) => Promise<void>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'addarr-lifecycle-'));
  const filePath = path.join(root, 'movie.mp4');
  fs.writeFileSync(filePath, '0123456789');
  const cfg = baseConfig();
  cfg.fileStreaming.enabled = true;
  cfg.fileStreaming.secret = FILE_SECRET;
  cfg.radarr.enabled = true;
  cfg.radarr.rootFolderPath = root;
  let arrCalls = 0;

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const pathname = new URL(String(input)).pathname;
    if (pathname === '/api/v3/moviefile/42') {
      arrCalls += 1;
      return new Response(JSON.stringify({ path: filePath }), { status: 200 });
    }
    return new Response('[]', { status: 200 });
  }) as typeof fetch;

  try {
    const app = createApp(cfg);
    await withServer(app, async (baseUrl) => run({ baseUrl, cfg, getArrCalls: () => arrCalls }));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    globalThis.fetch = ORIGINAL_FETCH;
  }
}

test('repeated Range requests reuse one Arr file-path resolution and avoid the 120/min full-request limit', async () => {
  await withMovieFile(async ({ baseUrl, cfg, getArrCalls }) => {
    const url = signedFileUrl(baseUrl, cfg, 'movie', 42);
    for (let i = 0; i < 130; i++) {
      const res = await ORIGINAL_FETCH(url, { headers: { Range: 'bytes=0-0' } });
      assert.equal(res.status, 206, `range request ${i + 1}`);
      assert.equal(await res.text(), '0');
    }
    assert.equal(getArrCalls(), 1, 'stable file ID should be resolved once during a playback burst');
  });
});

test('invalid-token flooding is isolated from a subsequent valid signed request', async () => {
  await withMovieFile(async ({ baseUrl, cfg }) => {
    const validToken = buildFileToken(FILE_SECRET, 'movie', 42);
    const invalidToken = validToken.replace(/.$/, validToken.endsWith('0') ? '1' : '0');

    let finalInvalidStatus = 0;
    for (let i = 0; i < 31; i++) {
      const res = await ORIGINAL_FETCH(signedFileUrl(baseUrl, cfg, 'movie', 42, { token: invalidToken }));
      finalInvalidStatus = res.status;
    }
    assert.equal(finalInvalidStatus, 429, 'invalid attempts should become rate limited');

    const valid = await ORIGINAL_FETCH(signedFileUrl(baseUrl, cfg, 'movie', 42));
    assert.equal(valid.status, 200, 'invalid-token bucket must not consume the valid playback bucket');
    assert.equal(await valid.text(), '0123456789');
  });
});

test('file route supports HEAD and private no-store media responses', async () => {
  await withMovieFile(async ({ baseUrl, cfg }) => {
    const res = await ORIGINAL_FETCH(signedFileUrl(baseUrl, cfg, 'movie', 42), { method: 'HEAD' });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-length'), '10');
    assert.equal(res.headers.get('accept-ranges'), 'bytes');
    assert.equal(res.headers.get('cache-control'), 'private, no-store');
    assert.equal(await res.text(), '');
  });
});

test('unsatisfiable Range request returns 416 rather than being rewritten to 404', async () => {
  await withMovieFile(async ({ baseUrl, cfg }) => {
    const res = await ORIGINAL_FETCH(signedFileUrl(baseUrl, cfg, 'movie', 42), {
      headers: { Range: 'bytes=999-1000' }
    });
    assert.equal(res.status, 416);
    assert.match(res.headers.get('content-range') ?? '', /^bytes \*\/10$/);
  });
});

test('/status.json exposes aggregate file-stream diagnostics without file tokens or paths', async () => {
  await withMovieFile(async ({ baseUrl, cfg }) => {
    const signed = signedFileUrl(baseUrl, cfg, 'movie', 42);
    const token = new URL(signed).searchParams.get('t') ?? '';
    const media = await ORIGINAL_FETCH(signed, { headers: { Range: 'bytes=0-1' } });
    assert.equal(media.status, 206);
    await media.arrayBuffer();

    const status = await ORIGINAL_FETCH(`${baseUrl}/status.json`);
    assert.equal(status.status, 200);
    const text = await status.text();
    assert.ok(!text.includes(token), 'status diagnostics must not expose signed file tokens');
    assert.ok(!text.includes(cfg.radarr.rootFolderPath), 'status diagnostics must not expose media roots');
    const body = JSON.parse(text) as {
      fileStreaming?: { diagnostics?: { requests?: number; rangeRequests?: number; finishedResponses?: number } };
    };
    assert.ok((body.fileStreaming?.diagnostics?.requests ?? 0) >= 1);
    assert.ok((body.fileStreaming?.diagnostics?.rangeRequests ?? 0) >= 1);
    assert.ok((body.fileStreaming?.diagnostics?.finishedResponses ?? 0) >= 1);
  });
});
