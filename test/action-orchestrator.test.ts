import test from 'node:test';
import assert from 'node:assert/strict';
import { createLogger } from '../src/logger.js';
import { ActionOrchestrator } from '../src/services/action-orchestrator.js';
import type { ParsedStremioId } from '../src/types.js';

function movie(id: string): ParsedStremioId {
  return { rawId: id, imdbId: id, kind: 'movie' };
}

function successfulResult(title = 'ok') {
  return { ok: true as const, service: 'radarr' as const, title, summary: 'done' };
}

function captureLogger() {
  const entries: Array<Record<string, unknown>> = [];
  const logger = createLogger('debug', {
    log: (line) => entries.push(JSON.parse(line) as Record<string, unknown>),
    error: (line) => entries.push(JSON.parse(line) as Record<string, unknown>)
  });
  return { logger, entries };
}

async function waitUntil(predicate: () => boolean, message: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 1));
  }
  assert.fail(message);
}

test('ActionOrchestrator deduplicates an action while its first job is in flight', async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let calls = 0;
  const statusService = {
    async triggerSearch() {
      calls += 1;
      await gate;
      return successfulResult();
    },
    async triggerAddAndSearch() { return successfulResult(); }
  };
  const { logger, entries } = captureLogger();
  const orchestrator = new ActionOrchestrator(statusService as never, logger, 10, async () => undefined);

  const first = orchestrator.enqueue('search', movie('tt1000001'), 'req-1');
  const duplicate = orchestrator.enqueue('search', movie('tt1000001'), 'req-2');

  assert.ok(first);
  assert.equal(duplicate, 'search:movie:tt1000001');
  assert.equal(calls, 1);
  assert.ok(entries.some((entry) => entry['message'] === 'Action queue deduped'));

  release();
  await waitUntil(() => entries.some((entry) => entry['message'] === 'Action completed'), 'deduplicated action did not complete');
  assert.equal(calls, 1);
});

test('ActionOrchestrator rejects a new action after the configured waiting queue is full', async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let calls = 0;
  const statusService = {
    async triggerSearch() {
      calls += 1;
      if (calls === 1) await gate;
      return successfulResult();
    },
    async triggerAddAndSearch() { return successfulResult(); }
  };
  const { logger, entries } = captureLogger();
  const orchestrator = new ActionOrchestrator(statusService as never, logger, 1, async () => undefined);

  assert.ok(orchestrator.enqueue('search', movie('tt2000001'))); // active
  assert.ok(orchestrator.enqueue('search', movie('tt2000002'))); // one waiting slot
  assert.equal(orchestrator.enqueue('search', movie('tt2000003')), null);
  assert.equal(calls, 1);
  assert.ok(entries.some((entry) => entry['message'] === 'Action queue full' && entry['queueDepth'] === 1));

  release();
  await waitUntil(
    () => entries.filter((entry) => entry['message'] === 'Action completed').length === 2,
    'active and queued actions did not both complete'
  );
  assert.equal(calls, 2);
});

test('ActionOrchestrator retries a transient execution failure and then succeeds', async () => {
  let calls = 0;
  const sleeps: number[] = [];
  const statusService = {
    async triggerSearch() {
      calls += 1;
      if (calls === 1) throw new Error('temporary Arr failure');
      return successfulResult('recovered');
    },
    async triggerAddAndSearch() { return successfulResult(); }
  };
  const { logger, entries } = captureLogger();
  const orchestrator = new ActionOrchestrator(
    statusService as never,
    logger,
    10,
    async (ms) => { sleeps.push(ms); }
  );

  orchestrator.enqueue('search', movie('tt3000001'));
  await waitUntil(() => entries.some((entry) => entry['message'] === 'Action completed'), 'retried action did not complete');

  assert.equal(calls, 2);
  assert.deepEqual(sleeps, [500]);
  assert.ok(entries.some((entry) => entry['message'] === 'Action attempt failed' && entry['attempt'] === 1));
  assert.equal(entries.some((entry) => entry['message'] === 'Action execution failed'), false);
});

test('ActionOrchestrator logs terminal failure, clears dedupe state, and accepts a later retry', async () => {
  let shouldFail = true;
  let calls = 0;
  const sleeps: number[] = [];
  const statusService = {
    async triggerSearch() {
      calls += 1;
      if (shouldFail) throw new Error('persistent Arr failure');
      return successfulResult('later success');
    },
    async triggerAddAndSearch() { return successfulResult(); }
  };
  const { logger, entries } = captureLogger();
  const orchestrator = new ActionOrchestrator(
    statusService as never,
    logger,
    10,
    async (ms) => { sleeps.push(ms); }
  );

  orchestrator.enqueue('search', movie('tt4000001'));
  await waitUntil(() => entries.some((entry) => entry['message'] === 'Action execution failed'), 'terminal failure was not logged');

  assert.equal(calls, 3);
  assert.deepEqual(sleeps, [500, 1000]);
  assert.equal(entries.filter((entry) => entry['message'] === 'Action attempt failed').length, 3);

  shouldFail = false;
  const next = orchestrator.enqueue('search', movie('tt4000001'));
  assert.ok(next);
  assert.notEqual(next, 'search:movie:tt4000001', 'completed failure must not leave the dedupe key locked');
  await waitUntil(
    () => entries.some((entry) => entry['message'] === 'Action completed' && entry['title'] === 'later success'),
    'later retry was not accepted after terminal failure'
  );
  assert.equal(calls, 4);
});

test('ActionOrchestrator dispatches add-search jobs to triggerAddAndSearch', async () => {
  let searchCalls = 0;
  let addSearchCalls = 0;
  const statusService = {
    async triggerSearch() {
      searchCalls += 1;
      return successfulResult();
    },
    async triggerAddAndSearch() {
      addSearchCalls += 1;
      return successfulResult('added');
    }
  };
  const { logger, entries } = captureLogger();
  const orchestrator = new ActionOrchestrator(statusService as never, logger, 10, async () => undefined);

  orchestrator.enqueue('add-search', movie('tt5000001'));
  await waitUntil(() => entries.some((entry) => entry['message'] === 'Action completed'), 'add-search job did not complete');

  assert.equal(addSearchCalls, 1);
  assert.equal(searchCalls, 0);
});
