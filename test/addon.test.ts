import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/index.js';
import { baseConfig, withServer } from './_helpers.js';

test('manifest endpoint shape sanity', async () => {
  const app = createApp(baseConfig());
  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/manifest.json`);
    assert.equal(response.status, 200);
    const manifest = (await response.json()) as {
      resources: string[];
      types: string[];
      idPrefixes: string[];
    };
    assert.deepEqual(manifest.resources, ['stream']);
    assert.deepEqual(manifest.types, ['movie', 'series']);
    assert.deepEqual(manifest.idPrefixes, ['tt']);
  });
});

test('stream handler output sanity for movie', async () => {
  const app = createApp(baseConfig());
  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/stream/movie/tt1234567.json`);
    assert.equal(response.status, 200);
    const body = (await response.json()) as { streams: Array<{ name: string }> };
    assert.equal(body.streams[0].name, 'Arr Offline');
  });
});
