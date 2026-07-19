import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp, redactAddonRequestPath } from '../src/index.js';
import { streamFromTile } from '../src/addon.js';
import { buildActionToken, verifyActionToken } from '../src/lib/action-tokens.js';
import { addonBasePath } from '../src/lib/addon-access.js';
import { buildFileToken, verifyFileToken } from '../src/lib/file-tokens.js';
import { SlidingWindowRateLimiter } from '../src/lib/rate-limiter.js';
import { baseConfig, withServer } from './_helpers.js';

test('request logging redacts the opaque add-on path token', () => {
  assert.equal(
    redactAddonRequestPath('/secret-install-token/stream/movie/tt123.json', '/secret-install-token'),
    '/<protected>/stream/movie/tt123.json'
  );
  assert.equal(redactAddonRequestPath('/healthz', '/secret-install-token'), '/healthz');
});

test('stream adapter rejects protocol-invalid source-less streams', () => {
  assert.throws(() => streamFromTile({ name: 'status only' }), /without a Stremio stream source/);
  assert.equal(streamFromTile({ name: 'ok', url: 'https://example.com/video.mp4' }).url, 'https://example.com/video.mp4');
});

test('action signatures expire and bind action, kind and id', () => {
  const secret = 'test-addon-access-token-0123456789abcdef';
  const exp = 2_000;
  const token = buildActionToken(secret, 'search', 'movie', 'tt1234567', exp);
  assert.equal(verifyActionToken(secret, 'search', 'movie', 'tt1234567', exp, token, 1_999), true);
  assert.equal(verifyActionToken(secret, 'add-search', 'movie', 'tt1234567', exp, token, 1_999), false);
  assert.equal(verifyActionToken(secret, 'search', 'movie', 'tt1234567', exp, token, 2_001), false);
});

test('file signatures expire', () => {
  const secret = 'file-secret';
  const exp = 2_000;
  const token = buildFileToken(secret, 'movie', 42, exp);
  assert.equal(verifyFileToken(secret, 'movie', 42, exp, token, 1_999), true);
  assert.equal(verifyFileToken(secret, 'movie', 42, exp, token, 2_001), false);
});

test('rate limiter bounds requests per key and resets', () => {
  const limiter = new SlidingWindowRateLimiter(2, 1000);
  assert.equal(limiter.isLimited('a', 0), false);
  assert.equal(limiter.isLimited('a', 1), false);
  assert.equal(limiter.isLimited('a', 2), true);
  assert.equal(limiter.isLimited('a', 1001), false);
});

test('Stremio resources are available only below the protected install path', async () => {
  const config = baseConfig();
  const app = createApp(config);
  await withServer(app, async (baseUrl) => {
    assert.equal((await fetch(`${baseUrl}/manifest.json`)).status, 404);
    const prefix = addonBasePath(config);
    const manifest = await fetch(`${baseUrl}${prefix}/manifest.json`);
    assert.equal(manifest.status, 200);
    const body = await manifest.json() as { behaviorHints?: { configurable?: boolean } };
    assert.equal(body.behaviorHints?.configurable, false);
    const noop = await fetch(`${baseUrl}${prefix}/status/movie/tt1234567.m3u8`);
    assert.equal(noop.status, 200);
    assert.match(await noop.text(), /#EXTM3U/);
  });
});
