const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_TOKEN_TTL_SEC = 7 * 24 * 60 * 60;
const MIN_REFRESH_LEAD_MS = 5 * 60 * 1000;
const MAX_REFRESH_LEAD_MS = 6 * 60 * 60 * 1000;

export interface TraktDeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_url: string;
  expires_in: number;
  interval: number;
}

export interface TraktTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in?: number;
  created_at?: number;
  token_type?: string;
  scope?: string;
}

export interface TraktTokenTiming {
  createdAtSec: number;
  expiresInSec: number;
  expiresAtMs: number;
  refreshAtMs: number;
}

export interface TraktRequestOptions {
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
  maxAttempts?: number;
  retryStatuses?: readonly number[];
}

export interface TraktDevicePollOptions extends TraktRequestOptions {
  apiBaseUrl: string;
  clientId: string;
  clientSecret: string;
  userAgent: string;
  device: TraktDeviceCodeResponse;
  now?: () => number;
  onStatus?: (status: string, detail?: string) => void;
}

export class TraktAuthError extends Error {
  constructor(
    message: string,
    readonly status = 0,
    readonly code = '',
    readonly retryAfterSec = 0,
    readonly responseText = ''
  ) {
    super(message);
    this.name = 'TraktAuthError';
  }
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function normalizeApiBaseUrl(value: string): string {
  return value.replace(/\/+$/, '');
}

function parseRetryAfter(value: string | null): number {
  if (!value) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return 0;
  return Math.max(0, Math.ceil((timestamp - Date.now()) / 1000));
}

function parseErrorCode(text: string): string {
  if (!text.trim()) return '';
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const code = parsed['error'] ?? parsed['code'];
    const description = parsed['error_description'] ?? parsed['message'];
    return [code, description]
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      .join(': ');
  } catch {
    return text.trim().slice(0, 240);
  }
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  fetchImpl: typeof fetch,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

export function traktApiHeaders(clientId: string, userAgent: string, accessToken = ''): Headers {
  const headers = new Headers({
    'content-type': 'application/json',
    'user-agent': userAgent,
    'trakt-api-key': clientId,
    'trakt-api-version': '2'
  });
  if (accessToken) headers.set('authorization', `Bearer ${accessToken}`);
  return headers;
}

export async function traktJsonRequest<T>(
  url: string,
  init: RequestInit,
  options: TraktRequestOptions = {}
): Promise<T> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? defaultSleep;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxAttempts = Math.max(1, options.maxAttempts ?? 3);
  const retryStatuses = new Set(options.retryStatuses ?? [429, 500, 502, 503, 504]);

  let lastError: TraktAuthError | undefined;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetchWithTimeout(url, init, fetchImpl, timeoutMs);
      const text = await response.text();
      if (response.ok) {
        if (!text.trim()) return undefined as T;
        try {
          return JSON.parse(text) as T;
        } catch {
          throw new TraktAuthError('trakt_invalid_json_response', response.status, '', 0, text);
        }
      }

      const retryAfterSec = parseRetryAfter(response.headers.get('retry-after'));
      const code = parseErrorCode(text);
      const error = new TraktAuthError(
        `trakt_http_${response.status}`,
        response.status,
        code,
        retryAfterSec,
        text
      );
      if (!retryStatuses.has(response.status) || attempt >= maxAttempts) throw error;

      lastError = error;
      const delayMs = retryAfterSec > 0
        ? retryAfterSec * 1000
        : Math.min(2_000, 250 * (2 ** (attempt - 1)));
      await sleep(delayMs);
      continue;
    } catch (error) {
      if (error instanceof TraktAuthError) throw error;

      const message = error instanceof Error && error.name === 'AbortError'
        ? 'trakt_request_timeout'
        : 'trakt_network_error';
      lastError = new TraktAuthError(
        message,
        0,
        error instanceof Error ? error.message : String(error)
      );
      if (attempt >= maxAttempts) throw lastError;
      await sleep(Math.min(2_000, 250 * (2 ** (attempt - 1))));
    }
  }

  throw lastError ?? new TraktAuthError('trakt_request_failed');
}

function validateDeviceCode(value: unknown): TraktDeviceCodeResponse {
  if (!value || typeof value !== 'object') throw new TraktAuthError('trakt_invalid_device_code_response');
  const raw = value as Record<string, unknown>;
  const device: TraktDeviceCodeResponse = {
    device_code: typeof raw['device_code'] === 'string' ? raw['device_code'] : '',
    user_code: typeof raw['user_code'] === 'string' ? raw['user_code'] : '',
    verification_url: typeof raw['verification_url'] === 'string' ? raw['verification_url'] : '',
    expires_in: Number(raw['expires_in']),
    interval: Number(raw['interval'])
  };
  if (!device.device_code || !device.user_code || !device.verification_url
    || !Number.isFinite(device.expires_in) || device.expires_in <= 0
    || !Number.isFinite(device.interval) || device.interval <= 0) {
    throw new TraktAuthError('trakt_invalid_device_code_response');
  }
  return device;
}

function validateToken(value: unknown): TraktTokenResponse {
  if (!value || typeof value !== 'object') throw new TraktAuthError('trakt_invalid_token_response');
  const raw = value as Record<string, unknown>;
  const accessToken = typeof raw['access_token'] === 'string' ? raw['access_token'].trim() : '';
  const refreshToken = typeof raw['refresh_token'] === 'string' ? raw['refresh_token'].trim() : '';
  if (!accessToken || !refreshToken) throw new TraktAuthError('trakt_invalid_token_response');
  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_in: Number.isFinite(Number(raw['expires_in'])) ? Number(raw['expires_in']) : undefined,
    created_at: Number.isFinite(Number(raw['created_at'])) ? Number(raw['created_at']) : undefined,
    token_type: typeof raw['token_type'] === 'string' ? raw['token_type'] : undefined,
    scope: typeof raw['scope'] === 'string' ? raw['scope'] : undefined
  };
}

export async function requestTraktDeviceCode(
  apiBaseUrl: string,
  clientId: string,
  userAgent: string,
  options: TraktRequestOptions = {}
): Promise<TraktDeviceCodeResponse> {
  const response = await traktJsonRequest<unknown>(
    `${normalizeApiBaseUrl(apiBaseUrl)}/oauth/device/code`,
    {
      method: 'POST',
      headers: traktApiHeaders(clientId, userAgent),
      body: JSON.stringify({ client_id: clientId })
    },
    options
  );
  return validateDeviceCode(response);
}

export async function pollTraktDeviceToken(options: TraktDevicePollOptions): Promise<TraktTokenResponse> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? defaultSleep;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const now = options.now ?? Date.now;
  const deadline = now() + options.device.expires_in * 1000;
  let intervalSec = Math.max(1, Math.ceil(options.device.interval));
  let transientErrors = 0;

  while (now() < deadline) {
    await sleep(intervalSec * 1000);
    let response: Response;
    try {
      response = await fetchWithTimeout(
        `${normalizeApiBaseUrl(options.apiBaseUrl)}/oauth/device/token`,
        {
          method: 'POST',
          headers: traktApiHeaders(options.clientId, options.userAgent),
          body: JSON.stringify({
            code: options.device.device_code,
            client_id: options.clientId,
            client_secret: options.clientSecret
          })
        },
        fetchImpl,
        timeoutMs
      );
    } catch (error) {
      transientErrors += 1;
      options.onStatus?.('network_error', error instanceof Error ? error.message : String(error));
      if (transientErrors >= 3) throw new TraktAuthError('trakt_device_poll_network_error');
      continue;
    }

    const text = await response.text();
    if (response.status === 200) {
      try {
        return validateToken(JSON.parse(text));
      } catch (error) {
        if (error instanceof TraktAuthError) throw error;
        throw new TraktAuthError('trakt_invalid_token_response', 200, '', 0, text);
      }
    }
    if (response.status === 400) {
      transientErrors = 0;
      options.onStatus?.('pending');
      continue;
    }
    if (response.status === 429) {
      const retryAfterSec = parseRetryAfter(response.headers.get('retry-after'));
      intervalSec = Math.max(intervalSec + 1, retryAfterSec || intervalSec + 5);
      options.onStatus?.('slow_down', String(intervalSec));
      continue;
    }
    if (response.status >= 500 && response.status < 600) {
      transientErrors += 1;
      options.onStatus?.('server_error', `HTTP ${response.status}`);
      if (transientErrors >= 3) {
        throw new TraktAuthError(
          `trakt_device_http_${response.status}`,
          response.status,
          'temporary Trakt server error during device polling',
          0,
          text
        );
      }
      continue;
    }

    const code = parseErrorCode(text);
    const messages: Record<number, string> = {
      404: 'trakt_device_code_invalid',
      409: 'trakt_device_code_already_used',
      410: 'trakt_device_code_expired',
      418: 'trakt_device_authorization_denied'
    };
    throw new TraktAuthError(
      messages[response.status] ?? `trakt_device_http_${response.status}`,
      response.status,
      code,
      0,
      text
    );
  }

  throw new TraktAuthError('trakt_device_code_expired', 410);
}

export async function refreshTraktToken(
  apiBaseUrl: string,
  clientId: string,
  clientSecret: string,
  refreshToken: string,
  redirectUri: string,
  userAgent: string,
  options: TraktRequestOptions = {}
): Promise<TraktTokenResponse> {
  const response = await traktJsonRequest<unknown>(
    `${normalizeApiBaseUrl(apiBaseUrl)}/oauth/token`,
    {
      method: 'POST',
      headers: traktApiHeaders(clientId, userAgent),
      body: JSON.stringify({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri
      })
    },
    options
  );
  return validateToken(response);
}

export async function verifyTraktAccessToken(
  apiBaseUrl: string,
  clientId: string,
  accessToken: string,
  userAgent: string,
  options: TraktRequestOptions = {}
): Promise<void> {
  await traktJsonRequest<unknown>(
    `${normalizeApiBaseUrl(apiBaseUrl)}/users/settings`,
    {
      method: 'GET',
      headers: traktApiHeaders(clientId, userAgent, accessToken)
    },
    options
  );
}

export function traktTokenTiming(token: Partial<TraktTokenResponse>, nowMs = Date.now()): TraktTokenTiming {
  const createdAtSec = Number.isFinite(token.created_at) && Number(token.created_at) > 0
    ? Math.floor(Number(token.created_at))
    : Math.floor(nowMs / 1000);
  const expiresInSec = Number.isFinite(token.expires_in) && Number(token.expires_in) > 0
    ? Math.floor(Number(token.expires_in))
    : DEFAULT_TOKEN_TTL_SEC;
  const expiresAtMs = createdAtSec * 1000 + expiresInSec * 1000;
  const refreshLeadMs = Math.min(
    MAX_REFRESH_LEAD_MS,
    Math.max(MIN_REFRESH_LEAD_MS, Math.floor(expiresInSec * 1000 * 0.1))
  );
  return {
    createdAtSec,
    expiresInSec,
    expiresAtMs,
    refreshAtMs: Math.max(nowMs, expiresAtMs - refreshLeadMs)
  };
}
