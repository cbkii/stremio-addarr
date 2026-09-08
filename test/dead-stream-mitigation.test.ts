import test from 'node:test';
import assert from 'node:assert/strict';
import { isConfidentSingleEpisodeFilename, streamFromTile } from '../src/addon.js';
import { FilePathResolverCache } from '../src/lib/file-path-cache.js';
import type { StatusTile } from '../src/types.js';

function directSeriesTile(filename: string, fileId = 88, extensionUrl = 'https://pi.example.com'): StatusTile {
  return {
    name: 'File Ready',
    bingeEligible: true,
    url: `${extensionUrl}/token/files/series/${fileId}?exp=9999999999&t=signed`,
    behaviorHints: {
      notWebReady: true,
      filename,
      videoSize: 123456
    }
  };
}

test('passive status placeholder becomes a Stremio detail deep link instead of media', () => {
  const stream = streamFromTile({
    name: 'Downloading',
    url: 'https://pi.example.com/token/status/series/tt7654321%3A2%3A5.m3u8',
    behaviorHints: { notWebReady: true }
  });

  assert.equal(stream.url, undefined);
  assert.equal(stream.externalUrl, 'stremio:///detail/series/tt7654321/tt7654321:2:5?autoPlay=false');
  assert.equal(stream.behaviorHints, undefined);
});

test('direct single-episode Sonarr files receive a stable bingeGroup', () => {
  const first = streamFromTile(directSeriesTile('Show.Name.S01E01.mkv', 88));
  const second = streamFromTile(directSeriesTile('Show.Name.S01E02.mkv', 89));

  assert.ok(first.behaviorHints?.bingeGroup);
  assert.equal(second.behaviorHints?.bingeGroup, first.behaviorHints?.bingeGroup);
  assert.equal(first.behaviorHints?.notWebReady, true);
});

test('web-ready HTTPS MP4 keeps bingeGroup when notWebReady is removed', () => {
  const stream = streamFromTile(directSeriesTile('Show.Name.S01E02.mp4'));
  assert.ok(stream.behaviorHints?.bingeGroup);
  assert.equal(stream.behaviorHints?.notWebReady, undefined);
  assert.equal(stream.behaviorHints?.filename, 'Show.Name.S01E02.mp4');
  assert.equal(stream.behaviorHints?.videoSize, 123456);
});

test('movies never receive the Sonarr bingeGroup', () => {
  const stream = streamFromTile({
    name: 'File Ready',
    url: 'https://pi.example.com/token/files/movie/77?exp=9999999999&t=signed',
    behaviorHints: {
      notWebReady: true,
      filename: 'Movie.Name.2026.mkv',
      videoSize: 123456
    }
  });
  assert.equal(stream.behaviorHints?.bingeGroup, undefined);
});

test('multi-episode and ambiguous filenames do not claim automatic continuity', () => {
  for (const filename of [
    'Show.S01E01E02.mkv',
    'Show.S01E01-E02.mkv',
    'Show.S01E01-02.mkv',
    'Show.1x01-02.mkv',
    'Show.Special.mkv'
  ]) {
    assert.equal(isConfidentSingleEpisodeFilename(filename), false, filename);
    const stream = streamFromTile(directSeriesTile(filename));
    assert.equal(stream.behaviorHints?.bingeGroup, undefined, filename);
  }
});

test('single-episode filename classifier accepts common Sonarr names', () => {
  assert.equal(isConfidentSingleEpisodeFilename('Show.Name.S01E02.mkv'), true);
  assert.equal(isConfidentSingleEpisodeFilename('Show Name - 1x02 - Title.mp4'), true);
});

test('shared Sonarr file cannot receive bingeGroup even with a single-episode-looking filename', () => {
  const tile = directSeriesTile('Show.Name.S01E02.mkv');
  tile.bingeEligible = false;
  const stream = streamFromTile(tile);
  assert.equal(stream.behaviorHints?.bingeGroup, undefined);
});

test('file path cache collapses concurrent resolution and supports invalidation', async () => {
  const cache = new FilePathResolverCache(60_000);
  let calls = 0;
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const resolver = async () => {
    calls += 1;
    await gate;
    return '/media/show/episode.mkv';
  };

  const first = cache.getOrResolve('series:88', resolver);
  const second = cache.getOrResolve('series:88', resolver);
  release?.();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(calls, 1);
  assert.equal(a.value, '/media/show/episode.mkv');
  assert.equal(b.value, '/media/show/episode.mkv');
  assert.deepEqual(new Set([a.source, b.source]), new Set(['miss', 'deduped']));

  const hit = await cache.getOrResolve('series:88', async () => {
    calls += 1;
    return '/unexpected';
  });
  assert.equal(hit.source, 'hit');
  assert.equal(calls, 1);

  cache.invalidate('series:88');
  const refreshed = await cache.getOrResolve('series:88', async () => {
    calls += 1;
    return '/media/show/replaced.mkv';
  });
  assert.equal(refreshed.source, 'miss');
  assert.equal(refreshed.value, '/media/show/replaced.mkv');
  assert.equal(calls, 2);
});

test('file path cache uses sliding inactivity expiry for active playback', async () => {
  let now = 0;
  let calls = 0;
  const cache = new FilePathResolverCache(100, 4, () => now);
  const resolver = async () => {
    calls += 1;
    return `/media/show/episode-${calls}.mkv`;
  };

  const first = await cache.getOrResolve('series:88', resolver);
  assert.equal(first.source, 'miss');
  assert.equal(first.value, '/media/show/episode-1.mkv');

  now = 90;
  const firstHit = await cache.getOrResolve('series:88', resolver);
  assert.equal(firstHit.source, 'hit');

  now = 180;
  const secondHit = await cache.getOrResolve('series:88', resolver);
  assert.equal(secondHit.source, 'hit');
  assert.equal(calls, 1, 'active hits should keep the resolved path alive without re-querying Arr');

  now = 281;
  const afterInactivity = await cache.getOrResolve('series:88', resolver);
  assert.equal(afterInactivity.source, 'miss');
  assert.equal(afterInactivity.value, '/media/show/episode-2.mkv');
  assert.equal(calls, 2, 'entry should expire after a full TTL with no use');
});

test('file path cache is bounded and evicts the least recently used path', async () => {
  let now = 0;
  const calls = new Map<string, number>();
  const cache = new FilePathResolverCache(1_000, 2, () => now);
  const resolve = (key: string) => async () => {
    calls.set(key, (calls.get(key) ?? 0) + 1);
    return `/media/${key}.mkv`;
  };

  await cache.getOrResolve('a', resolve('a'));
  now = 1;
  await cache.getOrResolve('b', resolve('b'));
  now = 2;
  assert.equal((await cache.getOrResolve('a', resolve('a'))).source, 'hit', 'touch a so b becomes least recently used');

  now = 3;
  await cache.getOrResolve('c', resolve('c'));

  now = 4;
  assert.equal((await cache.getOrResolve('a', resolve('a'))).source, 'hit', 'recently used a should remain cached');
  assert.equal(calls.get('a'), 1);

  now = 5;
  assert.equal((await cache.getOrResolve('b', resolve('b'))).source, 'miss', 'least recently used b should have been evicted');
  assert.equal(calls.get('b'), 2);
});
