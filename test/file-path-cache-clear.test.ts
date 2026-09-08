import test from 'node:test';
import assert from 'node:assert/strict';
import { FilePathResolverCache } from '../src/lib/file-path-cache.js';

test('clear prevents an older in-flight resolution from repopulating the path cache', async () => {
  const cache = new FilePathResolverCache(60_000);
  let calls = 0;
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });

  const first = cache.getOrResolve('series:88', async () => {
    calls += 1;
    await gate;
    return '/media/show/old.mkv';
  });

  cache.clear();
  release?.();
  const preClearResult = await first;
  assert.equal(preClearResult.value, '/media/show/old.mkv');

  const afterClear = await cache.getOrResolve('series:88', async () => {
    calls += 1;
    return '/media/show/new.mkv';
  });
  assert.equal(afterClear.source, 'miss', 'a pre-clear resolver must not repopulate entries after clear');
  assert.equal(afterClear.value, '/media/show/new.mkv');
  assert.equal(calls, 2);
});
