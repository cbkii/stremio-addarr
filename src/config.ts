import type { LogLevel } from './logger.js';

export interface PublicUrlValidation {
  isHttps: boolean;
  isLocalhost: boolean;
  warnings: string[];
}

export interface AppConfig {
  host: string;
  port: number;
  publicBaseUrl: string;
  publicUrlValidation: PublicUrlValidation;
  logLevel: LogLevel;
  requestTimeoutMs: number;
  statusCacheTtlMs: number;
  actionConfirm: boolean;
  radarr: {
    enabled: boolean;
    baseUrl: string;
    apiKey: string;
    rootFolderPath: string;
    qualityProfileId: number;
    minimumAvailability: string;
    tags: string[];
    searchOnAdd: boolean;
  };
  sonarr: {
    enabled: boolean;
    baseUrl: string;
    apiKey: string;
    rootFolderPath: string;
    qualityProfileId: number;
    languageProfileId: number;
    seriesMonitor: string;
    tags: string[];
    searchOnAdd: boolean;
  };
  tmdbApiKey?: string;
}

function readNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (Number.isNaN(value)) {
    throw new Error(`Environment variable ${name} must be a number.`);
  }
  return value;
}

function readBoolean(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (!raw) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase());
}

function readString(name: string, fallback = ''): string {
  return (process.env[name] ?? fallback).trim();
}

function readStringList(name: string): string[] {
  return readString(name)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

export function validatePublicUrl(publicBaseUrl: string): PublicUrlValidation {
  const warnings: string[] = [];
  let url: URL;

  try {
    url = new URL(publicBaseUrl);
  } catch {
    warnings.push(
      `PUBLIC_BASE_URL "${publicBaseUrl}" is not a valid URL. Remote Stremio clients will not be able to install the addon.`
    );
    return { isHttps: false, isLocalhost: false, warnings };
  }

  const isHttps = url.protocol === 'https:';
  const hostname = url.hostname;
  const isLocalhost =
    hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1';

  if (!isHttps && !isLocalhost) {
    warnings.push(
      `PUBLIC_BASE_URL uses HTTP ("${publicBaseUrl}"). Remote Stremio clients (Android TV, mobile) require HTTPS. ` +
        'Use Caddy or another reverse proxy to terminate TLS, then set PUBLIC_BASE_URL to the HTTPS address.'
    );
  }

  if (isLocalhost) {
    warnings.push(
      `PUBLIC_BASE_URL points to localhost ("${publicBaseUrl}"). ` +
        'This works for local testing only. Remote clients (e.g. Android TV) cannot reach a loopback address. ' +
        'Set PUBLIC_BASE_URL to an HTTPS LAN hostname (e.g. https://stremio-addarr.lan).'
    );
  }

  return { isHttps, isLocalhost, warnings };
}

export function loadConfig(): AppConfig {
  const host = readString('HOST', '0.0.0.0');
  const port = readNumber('PORT', 7010);
  const publicBaseUrl = stripTrailingSlash(
    readString('PUBLIC_BASE_URL', `http://127.0.0.1:${port}`)
  );

  const publicUrlValidation = validatePublicUrl(publicBaseUrl);

  const config: AppConfig = {
    host,
    port,
    publicBaseUrl,
    publicUrlValidation,
    logLevel: (readString('LOG_LEVEL', 'info') as LogLevel) ?? 'info',
    requestTimeoutMs: readNumber('REQUEST_TIMEOUT_MS', 5000),
    statusCacheTtlMs: readNumber('STATUS_CACHE_TTL_MS', 30000),
    actionConfirm: readBoolean('ACTION_CONFIRM', false),
    radarr: {
      enabled: readBoolean('RADARR_ENABLED', false),
      baseUrl: stripTrailingSlash(readString('RADARR_BASE_URL')),
      apiKey: readString('RADARR_API_KEY'),
      rootFolderPath: readString('RADARR_ROOT_FOLDER_PATH'),
      qualityProfileId: readNumber('RADARR_QUALITY_PROFILE_ID', 1),
      minimumAvailability: readString('RADARR_MINIMUM_AVAILABILITY', 'announced'),
      tags: readStringList('RADARR_TAGS'),
      searchOnAdd: readBoolean('RADARR_SEARCH_ON_ADD', true)
    },
    sonarr: {
      enabled: readBoolean('SONARR_ENABLED', false),
      baseUrl: stripTrailingSlash(readString('SONARR_BASE_URL')),
      apiKey: readString('SONARR_API_KEY'),
      rootFolderPath: readString('SONARR_ROOT_FOLDER_PATH'),
      qualityProfileId: readNumber('SONARR_QUALITY_PROFILE_ID', 1),
      languageProfileId: readNumber('SONARR_LANGUAGE_PROFILE_ID', 1),
      seriesMonitor: readString('SONARR_SERIES_MONITOR', 'all'),
      tags: readStringList('SONARR_TAGS'),
      searchOnAdd: readBoolean('SONARR_SEARCH_ON_ADD', true)
    },
    tmdbApiKey: readString('TMDB_API_KEY') || undefined
  };

  if (config.radarr.enabled && (!config.radarr.baseUrl || !config.radarr.apiKey)) {
    throw new Error('Radarr is enabled but RADARR_BASE_URL or RADARR_API_KEY is missing.');
  }

  if (config.sonarr.enabled && (!config.sonarr.baseUrl || !config.sonarr.apiKey)) {
    throw new Error('Sonarr is enabled but SONARR_BASE_URL or SONARR_API_KEY is missing.');
  }

  return config;
}
