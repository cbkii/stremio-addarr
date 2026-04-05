import test from 'node:test';
import assert from 'node:assert/strict';
import { HttpError, NetworkError, classifyError, friendlyErrorMessage } from '../src/lib/http.js';

test('HttpError: 401 classifies as auth_failed', () => {
  const err = new HttpError('Unauthorized', 401, '');
  assert.equal(err.kind, 'auth_failed');
});

test('HttpError: 403 classifies as auth_failed', () => {
  const err = new HttpError('Forbidden', 403, '');
  assert.equal(err.kind, 'auth_failed');
});

test('HttpError: 404 classifies as not_found', () => {
  const err = new HttpError('Not Found', 404, '');
  assert.equal(err.kind, 'not_found');
});

test('HttpError: 400 classifies as invalid_config', () => {
  const err = new HttpError('Bad Request', 400, '');
  assert.equal(err.kind, 'invalid_config');
});

test('HttpError: 422 classifies as invalid_config', () => {
  const err = new HttpError('Unprocessable', 422, '');
  assert.equal(err.kind, 'invalid_config');
});

test('HttpError: 500 classifies as unknown', () => {
  const err = new HttpError('Internal Server Error', 500, '');
  assert.equal(err.kind, 'unknown');
});

test('NetworkError: always classifies as unreachable', () => {
  const err = new NetworkError('Connection refused');
  assert.equal(err.kind, 'unreachable');
});

test('classifyError: NetworkError -> unreachable', () => {
  assert.equal(classifyError(new NetworkError('refused')), 'unreachable');
});

test('classifyError: Error with abort message -> unreachable', () => {
  assert.equal(classifyError(new Error('The operation was aborted')), 'unreachable');
});

test('classifyError: Error with timeout message -> unreachable', () => {
  assert.equal(classifyError(new Error('timeout exceeded')), 'unreachable');
});

test('classifyError: Error with ECONNREFUSED message -> unreachable', () => {
  assert.equal(classifyError(new Error('ECONNREFUSED 127.0.0.1:7878')), 'unreachable');
});

test('classifyError: generic Error -> unknown', () => {
  assert.equal(classifyError(new Error('some other error')), 'unknown');
});

test('friendlyErrorMessage: auth_failed returns helpful text', () => {
  const msg = friendlyErrorMessage(new HttpError('Unauthorized', 401, ''));
  assert.ok(msg.includes('API key'));
});

test('friendlyErrorMessage: unreachable returns helpful text', () => {
  const msg = friendlyErrorMessage(new NetworkError('connection refused'));
  assert.ok(msg.includes('unreachable'));
});

test('friendlyErrorMessage: invalid_config returns helpful text', () => {
  const msg = friendlyErrorMessage(new HttpError('Bad Request', 400, ''));
  assert.ok(msg.includes('root folder') || msg.includes('quality'));
});
