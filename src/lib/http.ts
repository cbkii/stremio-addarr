import type { ArrErrorKind } from '../types.js';

export interface HttpClientOptions {
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
  apiKeyHeader?: string;
}

export class HttpError extends Error {
  readonly kind: ArrErrorKind;

  constructor(
    message: string,
    readonly status: number,
    readonly body: string
  ) {
    super(message);
    this.kind = classifyHttpStatus(status);
  }
}

export class NetworkError extends Error {
  readonly kind: ArrErrorKind = 'unreachable';

  constructor(message: string) {
    super(message);
  }
}

function classifyHttpStatus(status: number): ArrErrorKind {
  if (status === 401 || status === 403) return 'auth_failed';
  if (status === 400 || status === 422) return 'invalid_config';
  if (status === 404) return 'not_found';
  return 'unknown';
}

export function classifyError(error: unknown): ArrErrorKind {
  if (error instanceof HttpError) return error.kind;
  if (error instanceof NetworkError) return 'unreachable';
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    if (msg.includes('aborted') || msg.includes('abort') || msg.includes('timeout')) {
      return 'unreachable';
    }
    if (msg.includes('econnrefused') || msg.includes('enotfound') || msg.includes('network')) {
      return 'unreachable';
    }
  }
  return 'unknown';
}

export function friendlyErrorMessage(error: unknown): string {
  const kind = classifyError(error);
  switch (kind) {
    case 'unreachable':
      return 'Service is unreachable. Check base URL and network connectivity.';
    case 'auth_failed':
      return 'Authentication failed. Check your API key.';
    case 'invalid_config':
      return 'Invalid request. Check root folder path and quality profile ID.';
    case 'not_found':
      return 'Resource not found.';
    default:
      return error instanceof Error ? error.message : 'Unknown error.';
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
        throw new HttpError(
          `Request failed with status ${response.status}`,
          response.status,
          text
        );
      }

      return text ? (JSON.parse(text) as T) : ({} as T);
    } catch (error) {
      if (error instanceof HttpError) throw error;
      // Wrap network/abort errors
      if (error instanceof Error) {
        throw new NetworkError(error.message);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}
