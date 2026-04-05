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

test('parses series id without season/episode', () => {
  const parsed = parseStremioId('series', 'tt9999999');
  assert.equal(parsed.imdbId, 'tt9999999');
  assert.equal(parsed.kind, 'series');
  assert.equal(parsed.season, undefined);
  assert.equal(parsed.episode, undefined);
  assert.equal(toStremioDetailLink(parsed), 'stremio:///detail/series/tt9999999/');
});

test('throws on invalid movie id', () => {
  assert.throws(() => parseStremioId('movie', 'not-an-imdb-id'), /Unsupported movie id/);
});

test('throws on invalid series imdb id', () => {
  assert.throws(() => parseStremioId('series', 'notimdb:1:2'), /Unsupported series imdb id/);
});

test('parses season 0 episode ids', () => {
  const parsed = parseStremioId('series', 'tt1111111:0:1');
  assert.equal(parsed.season, 0);
  assert.equal(parsed.episode, 1);
});

