import type { LogLevel } from './logger.js';

export interface AppConfig {
  appName: string;
  version: string;
  host: string;
  port: number;
  publicBaseUrl: string;
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

const LOG_LEVELS = new Set<LogLevel>(['debug', 'info', 'warn', 'error']);

function readNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (Number.isNaN(value)) {
    throw new Error(`Environment variable ${name} must be a number.`);
  }
  if (!Number.isFinite(value)) {
    throw new Error(`Environment variable ${name} must be finite.`);
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

function readRequiredString(name: string): string {
  const value = readString(name);
  if (!value) {
    throw new Error(`Environment variable ${name} is required.`);
  }
  return value;
}

function ensureHttpUrl(name: string, value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`Environment variable ${name} must be a valid URL.`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Environment variable ${name} must start with http:// or https://.`);
  }
  if (parsed.username || parsed.password) {
    throw new Error(`Environment variable ${name} must not contain embedded credentials (userinfo).`);
  }
  return stripTrailingSlash(parsed.toString());
}

export function loadConfig(): AppConfig {
  const packageVersion = process.env.npm_package_version?.trim() || '0.1.0';
  const host = readString('HOST', '0.0.0.0');
  const port = readNumber('PORT', 7010);
  const publicBaseUrl = ensureHttpUrl(
    'PUBLIC_BASE_URL',
    readString('PUBLIC_BASE_URL', `http://127.0.0.1:${port}`)
  );
  const requestTimeoutMs = readNumber('REQUEST_TIMEOUT_MS', 5000);
  const statusCacheTtlMs = readNumber('STATUS_CACHE_TTL_MS', 30000);
  if (requestTimeoutMs < 1000) throw new Error('REQUEST_TIMEOUT_MS must be at least 1000.');
  if (statusCacheTtlMs < 1000) throw new Error('STATUS_CACHE_TTL_MS must be at least 1000.');
  const logLevelRaw = readString('LOG_LEVEL', 'info') as LogLevel;
  if (!LOG_LEVELS.has(logLevelRaw)) {
    throw new Error('LOG_LEVEL must be one of: debug, info, warn, error.');
  }

  const config: AppConfig = {
    appName: 'stremio-addarr',
    version: packageVersion,
    host,
    port,
    publicBaseUrl,
    logLevel: logLevelRaw,
    requestTimeoutMs,
    statusCacheTtlMs,
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
    readRequiredString('RADARR_BASE_URL');
    readRequiredString('RADARR_API_KEY');
  }

  if (config.sonarr.enabled && (!config.sonarr.baseUrl || !config.sonarr.apiKey)) {
    readRequiredString('SONARR_BASE_URL');
    readRequiredString('SONARR_API_KEY');
  }

  if (config.radarr.enabled) {
    config.radarr.baseUrl = ensureHttpUrl('RADARR_BASE_URL', config.radarr.baseUrl);
  }
  if (config.sonarr.enabled) {
    config.sonarr.baseUrl = ensureHttpUrl('SONARR_BASE_URL', config.sonarr.baseUrl);
  }

  return config;
}
