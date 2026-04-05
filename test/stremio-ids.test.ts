import test from 'node:test';
import assert from 'node:assert/strict';
import { parseStremioId, toStremioDetailLink } from '../src/lib/stremio-ids.js';

test('parses movie ids', () => {
  const parsed = parseStremioId('movie', 'tt1234567');
  assert.equal(parsed.imdbId, 'tt1234567');
  assert.equal(parsed.kind, 'movie');
  assert.equal(toStremioDetailLink(parsed), 'stremio:///detail/movie/tt1234567/tt1234567');
});

test('parses episode ids', () => {
  const parsed = parseStremioId('series', 'tt7654321:2:4');
  assert.equal(parsed.imdbId, 'tt7654321');
  assert.equal(parsed.season, 2);
  assert.equal(parsed.episode, 4);
  assert.equal(toStremioDetailLink(parsed), 'stremio:///detail/series/tt7654321/tt7654321:2:4');
});



test('series ids without episode keep stable detail videoId', () => {
  const parsed = parseStremioId('series', 'tt8888888');
  assert.equal(parsed.videoId, 'tt8888888');
  assert.equal(toStremioDetailLink(parsed), 'stremio:///detail/series/tt8888888/tt8888888');
});

test('rejects malformed ids', () => {
  assert.throws(() => parseStremioId('movie', 'bad-id'), /Unsupported movie id/);
  assert.throws(() => parseStremioId('series', 'tt123:0:2'), /Unsupported series episode id/);
});
