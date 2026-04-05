import test from 'node:test';
import assert from 'node:assert/strict';
import { TtlCache } from '../src/lib/cache.js';

test('ttl cache expires entries', async () => {
  const cache = new TtlCache<number>(20);
  cache.set('k', 1);
  assert.equal(cache.get('k'), 1);
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(cache.get('k'), undefined);
});
