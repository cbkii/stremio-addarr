import type { LogLevel } from './logger.js';
import type { ConfigValidation } from './types.js';

export interface AppConfig {
  appName: string;
  version: string;
  host: string;
  port: number;
  publicBaseUrl: string;
  targetClient: 'android-tv' | 'generic';
  logLevel: LogLevel;
  requestTimeoutMs: number;
  statusCacheTtlMs: number;
  serviceHealthCacheTtlMs: number;
  streamCacheMaxAgeSec: number;
  streamStaleRevalidateSec: number;
  /** Number of catalog cards returned per page before Stremio asks for next skip. */
  catalogPageSize: number;
  /** Short local cache for merged catalog rows to reduce repeat Arr calls. */
  catalogCacheTtlMs: number;
  /** How long Stremio may cache catalog responses as fresh. */
  catalogCacheMaxAgeSec: number;
  /** How long Stremio may serve stale catalog while revalidating in background. */
  catalogStaleRevalidateSec: number;
  /** How long Stremio may serve stale catalog if revalidation errors. */
  catalogStaleErrorSec: number;
  /** Retry window for failed TMDB poster lookups (negative cache). */
  tmdbNegativeCacheTtlMs: number;
  fileStreaming: {
    enabled: boolean;
    secret: string;
    playbackMode: 'direct' | 'kodi';
  };
  kodi: {
    enabled: boolean;
    packageName: string;
  };
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

const LOG_LEVELS = new Set<LogLevel>(['debug', 'info', 'warn', 'error', 'none']);
const TARGET_CLIENTS = new Set<AppConfig['targetClient']>(['android-tv', 'generic']);
const FILE_STREAMING_PLAYBACK_MODES = new Set<AppConfig['fileStreaming']['playbackMode']>(['direct', 'kodi']);

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
  if (parsed.search || parsed.hash) {
    throw new Error(`Environment variable ${name} must not include query or hash components.`);
  }
  return stripTrailingSlash(parsed.toString());
}

function parseTargetClient(value: string): AppConfig['targetClient'] {
  const normalized = value.trim().toLowerCase() as AppConfig['targetClient'];
  if (!TARGET_CLIENTS.has(normalized)) {
    throw new Error('TARGET_CLIENT must be one of: android-tv, generic.');
  }
  return normalized;
}

function parseFileStreamingPlaybackMode(value: string): AppConfig['fileStreaming']['playbackMode'] {
  const normalized = value.trim().toLowerCase() as AppConfig['fileStreaming']['playbackMode'];
  if (!FILE_STREAMING_PLAYBACK_MODES.has(normalized)) {
    throw new Error('FILE_STREAMING_PLAYBACK_MODE must be one of: direct, kodi.');
  }
  return normalized;
}

function isIpAddress(hostname: string): boolean {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) {
    return hostname.split('.').every((part) => {
      const n = Number(part);
      return Number.isInteger(n) && n >= 0 && n <= 255;
    });
  }
  return hostname.includes(':');
}

function isInternalOnlyHostname(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  if (lower === 'localhost' || lower.endsWith('.localhost')) return true;
  if (lower.endsWith('.local') || lower.endsWith('.lan') || lower.endsWith('.home.arpa')) return true;
  return !lower.includes('.');
}

export function loadConfig(): AppConfig {
  const packageVersion = process.env.npm_package_version?.trim() || '0.1.0';
  const host = readString('HOST', '127.0.0.1');
  const port = readNumber('PORT', 7010);
  const publicBaseUrl = ensureHttpUrl('PUBLIC_BASE_URL', readRequiredString('PUBLIC_BASE_URL'));
  const targetClient = parseTargetClient(readString('TARGET_CLIENT', 'android-tv'));
  const requestTimeoutMs = readNumber('REQUEST_TIMEOUT_MS', 5000);
  const statusCacheTtlMs = readNumber('STATUS_CACHE_TTL_MS', 30000);
  const serviceHealthCacheTtlMs = readNumber('SERVICE_HEALTH_CACHE_TTL_MS', 10000);
  const streamCacheMaxAgeSec = readNumber(
    'STREAM_CACHE_MAX_AGE',
    readNumber('STREAM_CACHE_MAX_AGE_SEC', 2)
  );
  const streamStaleRevalidateSec = readNumber(
    'STREAM_STALE_REVALIDATE',
    readNumber('STREAM_STALE_REVALIDATE_SEC', 5)
  );
  const catalogPageSize = readNumber('CATALOG_PAGE_SIZE', 25);
  const catalogCacheTtlMs = readNumber('CATALOG_CACHE_TTL_MS', 5000);
  const catalogCacheMaxAgeSec = readNumber('CATALOG_CACHE_MAX_AGE_SEC', 15);
  const catalogStaleRevalidateSec = readNumber('CATALOG_STALE_REVALIDATE_SEC', 60);
  const catalogStaleErrorSec = readNumber('CATALOG_STALE_ERROR_SEC', 120);
  const tmdbNegativeCacheTtlMs = readNumber('TMDB_NEGATIVE_CACHE_TTL_MS', 60_000);

  if (requestTimeoutMs < 1000) throw new Error('REQUEST_TIMEOUT_MS must be at least 1000.');
  if (statusCacheTtlMs < 1000) throw new Error('STATUS_CACHE_TTL_MS must be at least 1000.');
  if (serviceHealthCacheTtlMs < 1000) {
    throw new Error('SERVICE_HEALTH_CACHE_TTL_MS must be at least 1000.');
  }
  if (streamCacheMaxAgeSec < 0) throw new Error('STREAM_CACHE_MAX_AGE must be at least 0.');
  if (streamStaleRevalidateSec < 0) {
    throw new Error('STREAM_STALE_REVALIDATE must be at least 0.');
  }
  if (catalogPageSize <= 0) {
    throw new Error('CATALOG_PAGE_SIZE must be greater than 0.');
  }
  if (catalogCacheTtlMs < 0) {
    throw new Error('CATALOG_CACHE_TTL_MS must be at least 0.');
  }
  if (catalogCacheMaxAgeSec < 0) {
    throw new Error('CATALOG_CACHE_MAX_AGE_SEC must be at least 0.');
  }
  if (catalogStaleRevalidateSec < 0) {
    throw new Error('CATALOG_STALE_REVALIDATE_SEC must be at least 0.');
  }
  if (catalogStaleErrorSec < 0) {
    throw new Error('CATALOG_STALE_ERROR_SEC must be at least 0.');
  }
  if (tmdbNegativeCacheTtlMs < 0) {
    throw new Error('TMDB_NEGATIVE_CACHE_TTL_MS must be at least 0.');
  }

  const logLevelRaw = readString('LOG_LEVEL', 'info') as LogLevel;
  if (!LOG_LEVELS.has(logLevelRaw)) {
    throw new Error('LOG_LEVEL must be one of: debug, info, warn, error, none.');
  }

  const fileStreamingEnabled = readBoolean('FILE_STREAMING_ENABLED', false);
  const fileStreamingSecret = readString('FILE_STREAMING_SECRET');
  const fileStreamingPlaybackMode = parseFileStreamingPlaybackMode(
    readString('FILE_STREAMING_PLAYBACK_MODE', fileStreamingEnabled ? 'direct' : 'kodi')
  );
  if (fileStreamingEnabled && !fileStreamingSecret) {
    throw new Error('FILE_STREAMING_SECRET is required when FILE_STREAMING_ENABLED=true.');
  }

  const config: AppConfig = {
    appName: 'stremio-addarr',
    version: packageVersion,
    host,
    port,
    publicBaseUrl,
    targetClient,
    logLevel: logLevelRaw,
    requestTimeoutMs,
    statusCacheTtlMs,
    serviceHealthCacheTtlMs,
    streamCacheMaxAgeSec,
    streamStaleRevalidateSec,
    catalogPageSize,
    catalogCacheTtlMs,
    catalogCacheMaxAgeSec,
    catalogStaleRevalidateSec,
    catalogStaleErrorSec,
    tmdbNegativeCacheTtlMs,
    fileStreaming: {
      enabled: fileStreamingEnabled,
      secret: fileStreamingSecret,
      playbackMode: fileStreamingPlaybackMode
    },
    kodi: {
      enabled: readBoolean('KODI_ENABLED', true),
      packageName: readString('KODI_PACKAGE', 'org.xbmc.kodi')
    },
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
    readRequiredString('RADARR_ROOT_FOLDER_PATH');
    if (config.radarr.qualityProfileId <= 0) {
      throw new Error('RADARR_QUALITY_PROFILE_ID must be greater than 0.');
    }
  }

  if (config.sonarr.enabled) {
    readRequiredString('SONARR_ROOT_FOLDER_PATH');
    if (config.sonarr.qualityProfileId <= 0) {
      throw new Error('SONARR_QUALITY_PROFILE_ID must be greater than 0.');
    }
    if (config.sonarr.languageProfileId <= 0) {
      throw new Error('SONARR_LANGUAGE_PROFILE_ID must be greater than 0.');
    }
  }

  if (config.kodi.enabled && !config.kodi.packageName) {
    throw new Error('KODI_PACKAGE must not be empty.');
  }

  if (config.radarr.enabled) {
    config.radarr.baseUrl = ensureHttpUrl('RADARR_BASE_URL', config.radarr.baseUrl);
  }
  if (config.sonarr.enabled) {
    config.sonarr.baseUrl = ensureHttpUrl('SONARR_BASE_URL', config.sonarr.baseUrl);
  }

  return config;
}

export function validateConfig(config: AppConfig): ConfigValidation {
  const issues: string[] = [];
  let isHttps = false;
  let isHostnameIp = false;
  let isInternalHostname = false;
  let hasPathPrefix = false;

  try {
    const parsed = new URL(config.publicBaseUrl);
    isHttps = parsed.protocol === 'https:';
    isHostnameIp = isIpAddress(parsed.hostname);
    isInternalHostname = isInternalOnlyHostname(parsed.hostname);
    hasPathPrefix = parsed.pathname !== '/';

    if (!isHttps) {
      issues.push('PUBLIC_BASE_URL uses HTTP');
    }
    if (isHostnameIp) {
      issues.push('PUBLIC_BASE_URL uses an IP address');
    }
    if (isInternalHostname) {
      issues.push('PUBLIC_BASE_URL uses internal-only hostname');
    }
    if (hasPathPrefix) {
      issues.push('PUBLIC_BASE_URL includes a path prefix, which is unsupported');
    }
  } catch {
    issues.push('PUBLIC_BASE_URL is not a valid URL');
  }

  const androidTvLikelyBroken =
    config.targetClient === 'android-tv' && (!isHttps || isHostnameIp || isInternalHostname || hasPathPrefix);
  if (androidTvLikelyBroken) {
    issues.push('Android TV compatibility likely broken');
    issues.push('Caddy/public certificate recommended');
  }

  if (!config.radarr.enabled && !config.sonarr.enabled) {
    issues.push('Neither Radarr nor Sonarr is enabled — add-on will show no useful tiles');
  }

  return {
    issues,
    isHttps,
    targetClient: config.targetClient,
    isHostnameIp,
    isInternalHostname,
    hasPathPrefix,
    likelyAndroidTvCompatible: !androidTvLikelyBroken,
    recommendedCaddyPublicCert: androidTvLikelyBroken
  };
}
