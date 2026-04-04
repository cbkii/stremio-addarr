export interface HttpClientOptions {
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
  apiKeyHeader?: string;
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
    } finally {
      clearTimeout(timeout);
    }
  }
}
