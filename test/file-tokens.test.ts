import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFileToken, verifyFileToken } from '../src/lib/file-tokens.js';

const SECRET = 'test-secret-32-chars-long-enough!!';

test('buildFileToken produces a 64-char hex string', () => {
  const token = buildFileToken(SECRET, 'movie', 42);
  assert.equal(token.length, 64);
  assert.match(token, /^[0-9a-f]{64}$/);
});

test('buildFileToken is deterministic', () => {
  assert.equal(buildFileToken(SECRET, 'movie', 42), buildFileToken(SECRET, 'movie', 42));
});

test('buildFileToken differs by kind', () => {
  assert.notEqual(buildFileToken(SECRET, 'movie', 42), buildFileToken(SECRET, 'series', 42));
});

test('buildFileToken differs by fileId', () => {
  assert.notEqual(buildFileToken(SECRET, 'movie', 42), buildFileToken(SECRET, 'movie', 43));
});

test('buildFileToken differs by secret', () => {
  const other = 'different-secret-32-chars-longeee';
  assert.notEqual(buildFileToken(SECRET, 'movie', 42), buildFileToken(other, 'movie', 42));
});

test('verifyFileToken returns true for correct token', () => {
  const token = buildFileToken(SECRET, 'movie', 42);
  assert.equal(verifyFileToken(SECRET, 'movie', 42, token), true);
});

test('verifyFileToken returns false for tampered token', () => {
  const token = buildFileToken(SECRET, 'movie', 42);
  const tampered = token.slice(0, -1) + (token.endsWith('0') ? '1' : '0');
  assert.equal(verifyFileToken(SECRET, 'movie', 42, tampered), false);
});

test('verifyFileToken returns false for wrong kind', () => {
  const token = buildFileToken(SECRET, 'movie', 42);
  assert.equal(verifyFileToken(SECRET, 'series', 42, token), false);
});

test('verifyFileToken returns false for wrong fileId', () => {
  const token = buildFileToken(SECRET, 'movie', 42);
  assert.equal(verifyFileToken(SECRET, 'movie', 43, token), false);
});

test('verifyFileToken returns false for wrong secret', () => {
  const token = buildFileToken(SECRET, 'movie', 42);
  assert.equal(verifyFileToken('different-secret-32-chars-longeee', 'movie', 42, token), false);
});

test('verifyFileToken returns false for empty token', () => {
  assert.equal(verifyFileToken(SECRET, 'movie', 42, ''), false);
});

test('verifyFileToken returns false for token of wrong length', () => {
  assert.equal(verifyFileToken(SECRET, 'movie', 42, 'abc'), false);
});

test('verifyFileToken returns false for non-hex token of correct length', () => {
  const expected = buildFileToken(SECRET, 'movie', 42);
  const nonHex = 'z'.repeat(expected.length);
  assert.equal(verifyFileToken(SECRET, 'movie', 42, nonHex), false);
});
