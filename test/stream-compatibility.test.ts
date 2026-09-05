import test from 'node:test';
import assert from 'node:assert/strict';
import { streamFromTile } from '../src/addon.js';
import { loadConfig } from '../src/config.js';
import { buildFileToken, verifyFileToken } from '../src/lib/file-tokens.js';
import { isWebReadyHttpsMp4 } from '../src/lib/stream-readiness.js';
import { ArrStatusService } from '../src/services/status.js';
import type { StatusTile } from '../src/types.js';

const SECRET = 'test-streaming-secret-32-chars-xx';
const ORIGINAL_ENV = { ...process.env };

test.afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

function useMinimalConfigEnv(): void {
  process.env = {
    ...ORIGINAL_ENV,
    PUBLIC_BASE_URL: 'https://stremio-addarr.example.com',
    ADDON_ACCESS_TOKEN: 'test-addon-access-token-0123456789abcdef',
    RADARR_ENABLED: 'false',
    SONARR_ENABLED: 'false',
    FILE_STREAMING_ENABLED: 'false',
    CONFIG_UI_ENABLED: 'false',
    TRAKT_SYNC_ENABLED: 'false'
  };
  delete process.env.FILE_STREAM_TOKEN_TTL_SEC;
}

function directTile(url: string, filename?: string): StatusTile {
  return {
    name: 'File Ready',
    url,
    behaviorHints: {
      notWebReady: true,
      ...(filename ? { filename } : {}),
      videoSize: 3_221_225_472
    }
  };
}

test('HTTPS MP4 stream omits notWebReady while preserving subtitle metadata', () => {
  const stream = streamFromTile(directTile(
    'https://media.example.com/protected/files/movie/77?exp=2000000000&t=abc',
    'Test.Movie.2020.mp4'
  ));

  assert.equal(stream.behaviorHints?.notWebReady, undefined);
  assert.equal(stream.behaviorHints?.filename, 'Test.Movie.2020.mp4');
  assert.equal(stream.behaviorHints?.videoSize, 3_221_225_472);
});

test('HTTPS MKV stream retains notWebReady', () => {
  const stream = streamFromTile(directTile('https://media.example.com/files/movie/77', 'Test.Movie.2020.mkv'));
  assert.equal(stream.behaviorHints?.notWebReady, true);
});

test('HTTP MP4 stream retains notWebReady', () => {
  const stream = streamFromTile(directTile('http://media.example.com/files/movie/77', 'Test.Movie.2020.mp4'));
  assert.equal(stream.behaviorHints?.notWebReady, true);
});

test('uppercase MP4 extension is classified as web-ready over HTTPS', () => {
  const stream = streamFromTile(directTile('https://media.example.com/files/series/88', 'Show.S01E02.MP4'));
  assert.equal(stream.behaviorHints?.notWebReady, undefined);
});

test('missing filename remains conservatively notWebReady', () => {
  const stream = streamFromTile(directTile('https://media.example.com/files/movie/77'));
  assert.equal(stream.behaviorHints?.notWebReady, true);
});

test('signed query parameters do not interfere with MP4 classification', () => {
  assert.equal(
    isWebReadyHttpsMp4(
      'https://media.example.com/files/movie/77?exp=2000000000&t=deadbeef',
      'Movie.release.final.mp4'
    ),
    true
  );
});

test('malformed stream URL remains conservatively notWebReady', () => {
  const stream = streamFromTile(directTile('not-a-valid-url', 'Movie.mp4'));
  assert.equal(stream.behaviorHints?.notWebReady, true);
});

test('default file-stream token lifetime is eight hours and remains configurable', () => {
  useMinimalConfigEnv();
  const defaultConfig = loadConfig();
  assert.equal(defaultConfig.fileStreaming.tokenTtlSec, 28_800);

  process.env.FILE_STREAM_TOKEN_TTL_SEC = '7200';
  const overriddenConfig = loadConfig();
  assert.equal(overriddenConfig.fileStreaming.tokenTtlSec, 7_200);
});

test('generated default file URL remains valid beyond the former one-hour boundary', () => {
  useMinimalConfigEnv();
  const config = loadConfig();
  config.fileStreaming = {
    ...config.fileStreaming,
    enabled: true,
    secret: SECRET,
    playbackMode: 'direct'
  };

  const service = new ArrStatusService(config);
  const issuedAt = Math.floor(Date.now() / 1000);
  const url = new URL(service.buildFileStreamUrl('movie', 42));
  const expiresAt = Number(url.searchParams.get('exp'));
  const token = url.searchParams.get('t') ?? '';

  assert.ok(expiresAt - issuedAt >= 28_799 && expiresAt - issuedAt <= 28_801);
  assert.equal(verifyFileToken(SECRET, 'movie', 42, expiresAt, token, issuedAt + 3_601), true);
  assert.equal(verifyFileToken(SECRET, 'movie', 42, expiresAt, token, expiresAt + 1), false);
});

test('file token verifier rejects an expiry beyond the existing 24-hour safety horizon', () => {
  const now = 2_000_000_000;
  const expiresAt = now + 86_401;
  const token = buildFileToken(SECRET, 'movie', 42, expiresAt);
  assert.equal(verifyFileToken(SECRET, 'movie', 42, expiresAt, token, now), false);
});
