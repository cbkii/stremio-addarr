import type { ParsedStremioId } from '../types.js';
import type { Logger } from '../logger.js';
import type { ArrStatusService } from './status.js';

type ActionName = 'search' | 'add-search';

interface ActionJob {
  id: string;
  action: ActionName;
  parsed: ParsedStremioId;
  reqId?: string;
  attempts: number;
  enqueuedAt: number;
}

const MAX_ATTEMPTS = 3;
const RETRY_BASE_MS = 500;

/**
 * In-process async queue for Arr-triggering actions.
 * The HTTP request can return immediately while this worker executes retries.
 */
export class ActionOrchestrator {
  private readonly queue: ActionJob[] = [];
  private readonly queuedKeys = new Set<string>();
  private running = false;
  private seq = 0;

  constructor(
    private readonly statusService: ArrStatusService,
    private readonly logger: Logger
  ) {}

  enqueue(action: ActionName, parsed: ParsedStremioId, reqId?: string): string {
    const dedupeKey = `${action}:${parsed.kind}:${parsed.rawId}`;
    if (this.queuedKeys.has(dedupeKey)) {
      this.logger.info('Action queue deduped', { reqId, action, kind: parsed.kind, id: parsed.rawId });
      return dedupeKey;
    }

    const job: ActionJob = {
      id: `${Date.now()}-${++this.seq}`,
      action,
      parsed,
      reqId,
      attempts: 0,
      enqueuedAt: Date.now()
    };
    this.queue.push(job);
    this.queuedKeys.add(dedupeKey);
    this.logger.info('Action queued', { reqId, action, kind: parsed.kind, id: parsed.rawId, jobId: job.id, queueDepth: this.queue.length });
    this.ensureRunner();
    return job.id;
  }

  private ensureRunner(): void {
    if (this.running) return;
    this.running = true;
    void this.runLoop();
  }

  private async runLoop(): Promise<void> {
    while (this.queue.length > 0) {
      const job = this.queue.shift();
      if (!job) continue;
      const dedupeKey = `${job.action}:${job.parsed.kind}:${job.parsed.rawId}`;
      const startedAt = Date.now();
      try {
        const result = await this.executeWithRetry(job);
        if (result.ok) {
          this.logger.info('Action completed', {
            reqId: job.reqId,
            background: true,
            action: job.action,
            kind: job.parsed.kind,
            encodedId: job.parsed.rawId,
            title: result.title,
            jobId: job.id,
            durationMs: Date.now() - startedAt,
            queuedForMs: startedAt - job.enqueuedAt
          });
        } else {
          this.logger.warn('Action rejected by Arr service', {
            reqId: job.reqId,
            background: true,
            action: job.action,
            kind: job.parsed.kind,
            encodedId: job.parsed.rawId,
            title: result.title,
            summary: result.summary,
            jobId: job.id,
            durationMs: Date.now() - startedAt,
            queuedForMs: startedAt - job.enqueuedAt
          });
        }
      } catch (error) {
        this.logger.error('Action execution failed', {
          reqId: job.reqId,
          background: true,
          error: error instanceof Error ? error.message : String(error),
          action: job.action,
          kind: job.parsed.kind,
          encodedId: job.parsed.rawId,
          jobId: job.id,
          durationMs: Date.now() - startedAt,
          queuedForMs: startedAt - job.enqueuedAt
        });
      } finally {
        this.queuedKeys.delete(dedupeKey);
      }
    }
    this.running = false;
  }

  private async executeWithRetry(job: ActionJob) {
    let lastError: unknown;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      job.attempts = attempt;
      try {
        return job.action === 'add-search'
          ? await this.statusService.triggerAddAndSearch(job.parsed)
          : await this.statusService.triggerSearch(job.parsed);
      } catch (error) {
        lastError = error;
        this.logger.warn('Action attempt failed', {
          reqId: job.reqId,
          background: true,
          action: job.action,
          kind: job.parsed.kind,
          encodedId: job.parsed.rawId,
          jobId: job.id,
          attempt,
          maxAttempts: MAX_ATTEMPTS,
          error: error instanceof Error ? error.message : String(error)
        });
        if (attempt < MAX_ATTEMPTS) {
          await this.sleep(RETRY_BASE_MS * attempt);
        }
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  private async sleep(ms: number): Promise<void> {
    await new Promise<void>((resolve) => setTimeout(resolve, ms));
  }
}
