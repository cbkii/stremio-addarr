import type { Logger } from '../logger.js';

export interface HttpClientOptions {
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
  apiKeyHeader?: string;
  /** Optional logger for outgoing request/response diagnostics. */
  logger?: Logger;
  /** Service name used as a log field (e.g. 'radarr', 'sonarr'). */
  serviceName?: string;
}

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string
  ) {
    super(message);
  }
}

export class HttpTimeoutError extends Error {
  constructor(message: string) {
    super(message);
  }
}

export class JsonHttpClient {
  private readonly apiKeyHeader: string;

  constructor(private readonly options: HttpClientOptions) {
    this.apiKeyHeader = options.apiKeyHeader ?? 'X-Api-Key';
  }

  async get<T>(path: string): Promise<T> {
    return this.request<T>(path, { method: 'GET' });
  }

  async post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs);
    const start = Date.now();
    const service = this.options.serviceName ?? 'http';
    const method = (init.method ?? 'GET').toUpperCase();

    this.options.logger?.debug('arr request', { service, method, path });

    try {
      const response = await fetch(`${this.options.baseUrl}${path}`, {
        ...init,
        headers: {
          [this.apiKeyHeader]: this.options.apiKey,
          Accept: 'application/json',
          ...(init.headers ?? {})
        },
        signal: controller.signal
      });

      const text = await response.text();
      if (!response.ok) {
        this.options.logger?.warn('arr response error', {
          service,
          method,
          path,
          status: response.status,
          durationMs: Date.now() - start,
          errorCategory: response.status === 401 || response.status === 403 ? 'auth' : 'http_error'
        });
        throw new HttpError(
          `Request failed with status ${response.status}`,
          response.status,
          text
        );
      }

      this.options.logger?.debug('arr response', { service, method, path, status: response.status, durationMs: Date.now() - start });
      return text ? (JSON.parse(text) as T) : ({} as T);
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        this.options.logger?.warn('arr timeout', { service, method, path, durationMs: Date.now() - start, errorCategory: 'timeout' });
        throw new HttpTimeoutError(`Request timed out after ${this.options.timeoutMs}ms`);
      }
      if (!(error instanceof HttpError)) {
        this.options.logger?.warn('arr request failed', { service, method, path, durationMs: Date.now() - start, errorCategory: 'network', error: error instanceof Error ? error.message : String(error) });
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}
