import test from 'node:test';
import assert from 'node:assert/strict';
import { AsyncTtlCache, TtlCache } from '../src/lib/cache.js';

test('ttl cache expires entries', async () => {
  const cache = new TtlCache<number>(20);
  cache.set('k', 1);
  assert.equal(cache.get('k'), 1);
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(cache.get('k'), undefined);
});

test('AsyncTtlCache deduplicates concurrent factories for the same key', async () => {
  const cache = new AsyncTtlCache<number>(1_000);
  let factoryCalls = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const factory = async () => {
    factoryCalls += 1;
    await gate;
    return 42;
  };

  const first = cache.getOrSet('same-key', factory);
  const second = cache.getOrSet('same-key', factory);

  assert.equal(factoryCalls, 1);
  release();
  assert.deepEqual(await Promise.all([first, second]), [42, 42]);
  assert.equal(factoryCalls, 1);

  assert.equal(await cache.getOrSet('same-key', async () => {
    factoryCalls += 1;
    return 99;
  }), 42);
  assert.equal(factoryCalls, 1, 'resolved value should be cached after the shared factory completes');
});

test('AsyncTtlCache clears rejected in-flight work so a later request can retry', async () => {
  const cache = new AsyncTtlCache<number>(1_000);
  let factoryCalls = 0;
  const failure = new Error('factory failed');
  const failingFactory = async () => {
    factoryCalls += 1;
    throw failure;
  };

  const first = cache.getOrSet('retry-key', failingFactory);
  const second = cache.getOrSet('retry-key', failingFactory);

  const results = await Promise.allSettled([first, second]);
  assert.equal(factoryCalls, 1);
  assert.equal(results[0]?.status, 'rejected');
  assert.equal(results[1]?.status, 'rejected');
  if (results[0]?.status === 'rejected') assert.equal(results[0].reason, failure);
  if (results[1]?.status === 'rejected') assert.equal(results[1].reason, failure);

  const recovered = await cache.getOrSet('retry-key', async () => {
    factoryCalls += 1;
    return 7;
  });
  assert.equal(recovered, 7);
  assert.equal(factoryCalls, 2, 'a rejected factory must not leave the key permanently in-flight');
});
