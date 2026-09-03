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
  const waiters = new Set<{
    predicate: (entry: Record<string, unknown>, allEntries: Array<Record<string, unknown>>) => boolean;
    resolve: (entry: Record<string, unknown>) => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
  }>();

  const record = (line: string) => {
    const entry = JSON.parse(line) as Record<string, unknown>;
    entries.push(entry);
    for (const waiter of [...waiters]) {
      if (!waiter.predicate(entry, entries)) continue;
      clearTimeout(waiter.timer);
      waiters.delete(waiter);
      waiter.resolve(entry);
    }
  };

  const logger = createLogger('debug', { log: record, error: record });

  const waitForEntry = (
    predicate: (entry: Record<string, unknown>, allEntries: Array<Record<string, unknown>>) => boolean,
    message: string,
    timeoutMs = 5_000
  ): Promise<Record<string, unknown>> => {
    const existing = entries.find((entry) => predicate(entry, entries));
    if (existing) return Promise.resolve(existing);

    return new Promise<Record<string, unknown>>((resolve, reject) => {
      const waiter = {
        predicate,
        resolve,
        reject,
        timer: setTimeout(() => {
          waiters.delete(waiter);
          reject(new Error(message));
        }, timeoutMs)
      };
      waiters.add(waiter);
    });
  };

  return { logger, entries, waitForEntry };
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
  const { logger, entries, waitForEntry } = captureLogger();
  const orchestrator = new ActionOrchestrator(statusService as never, logger, 10, async () => undefined);

  const first = orchestrator.enqueue('search', movie('tt1000001'), 'req-1');
  const duplicate = orchestrator.enqueue('search', movie('tt1000001'), 'req-2');

  assert.ok(first);
  assert.equal(duplicate, 'search:movie:tt1000001');
  assert.equal(calls, 1);
  assert.ok(entries.some((entry) => entry['message'] === 'Action queue deduped'));

  const completed = waitForEntry(
    (entry) => entry['message'] === 'Action completed',
    'deduplicated action did not complete'
  );
  release();
  await completed;
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
  const { logger, entries, waitForEntry } = captureLogger();
  const orchestrator = new ActionOrchestrator(statusService as never, logger, 1, async () => undefined);

  assert.ok(orchestrator.enqueue('search', movie('tt2000001'))); // active
  assert.ok(orchestrator.enqueue('search', movie('tt2000002'))); // one waiting slot
  assert.equal(orchestrator.enqueue('search', movie('tt2000003')), null);
  assert.equal(calls, 1);
  assert.ok(entries.some((entry) => entry['message'] === 'Action queue full' && entry['queueDepth'] === 1));

  const bothCompleted = waitForEntry(
    (entry, allEntries) => entry['message'] === 'Action completed'
      && allEntries.filter((candidate) => candidate['message'] === 'Action completed').length === 2,
    'active and queued actions did not both complete'
  );
  release();
  await bothCompleted;
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
  const { logger, entries, waitForEntry } = captureLogger();
  const orchestrator = new ActionOrchestrator(
    statusService as never,
    logger,
    10,
    async (ms) => { sleeps.push(ms); }
  );

  const completed = waitForEntry(
    (entry) => entry['message'] === 'Action completed',
    'retried action did not complete'
  );
  orchestrator.enqueue('search', movie('tt3000001'));
  await completed;

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
  const { logger, entries, waitForEntry } = captureLogger();
  const orchestrator = new ActionOrchestrator(
    statusService as never,
    logger,
    10,
    async (ms) => { sleeps.push(ms); }
  );

  const terminalFailure = waitForEntry(
    (entry) => entry['message'] === 'Action execution failed',
    'terminal failure was not logged'
  );
  orchestrator.enqueue('search', movie('tt4000001'));
  await terminalFailure;

  assert.equal(calls, 3);
  assert.deepEqual(sleeps, [500, 1000]);
  assert.equal(entries.filter((entry) => entry['message'] === 'Action attempt failed').length, 3);

  shouldFail = false;
  const laterSuccess = waitForEntry(
    (entry) => entry['message'] === 'Action completed' && entry['title'] === 'later success',
    'later retry was not accepted after terminal failure'
  );
  const next = orchestrator.enqueue('search', movie('tt4000001'));
  assert.ok(next);
  assert.notEqual(next, 'search:movie:tt4000001', 'completed failure must not leave the dedupe key locked');
  await laterSuccess;
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
  const { logger, waitForEntry } = captureLogger();
  const orchestrator = new ActionOrchestrator(statusService as never, logger, 10, async () => undefined);

  const completed = waitForEntry(
    (entry) => entry['message'] === 'Action completed',
    'add-search job did not complete'
  );
  orchestrator.enqueue('add-search', movie('tt5000001'));
  await completed;

  assert.equal(addSearchCalls, 1);
  assert.equal(searchCalls, 0);
});
