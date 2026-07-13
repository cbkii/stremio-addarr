import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { LogLevel } from './logger.js';
import type { ConfigValidation } from './types.js';

export interface AppConfig {
  appName: string;
  version: string;
  host: string;
  port: number;
  publicBaseUrl: string;
  manifestLogoUrl: string;
  targetClient: 'android-tv' | 'generic';
  timeZone: string;
  logLevel: LogLevel;
  requestTimeoutMs: number;
  gracefulShutdownTimeoutMs: number;
  forcedShutdownExitCode: 0 | 1;
  statusCacheTtlMs: number;
  serviceHealthCacheTtlMs: number;
  streamCacheMaxAgeSec: number;
  streamStaleRevalidateSec: number;
  /** Number of catalog cards returned per page before Stremio asks for next skip. */
  catalogPageSize: number;
  /** Keep this many watched movie cards in filtered Radarr catalogs before hiding the rest. */
  radarrCatalogWatchedKeepCount: number;
  /** Short local cache for merged catalog rows to reduce repeat Arr calls. */
  catalogCacheTtlMs: number;
  /** How long Stremio may cache catalog responses as fresh. */
  catalogCacheMaxAgeSec: number;
  /** How long Stremio may serve stale catalog while revalidating in background. */
  catalogStaleRevalidateSec: number;
  /** How long Stremio may serve stale catalog if revalidation errors. */
  catalogStaleErrorSec: number;
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
    cardUrl: string;
    apiKey: string;
    rootFolderPath: string;
    qualityProfileId: number;
    minimumAvailability: string;
    tags: number[];
    searchOnAdd: boolean;
    strictImdbMatch: boolean;
  };
  sonarr: {
    enabled: boolean;
    baseUrl: string;
    cardUrl: string;
    apiKey: string;
    rootFolderPath: string;
    qualityProfileId: number;
    languageProfileId: number | null;
    seriesMonitor:
      | 'all'
      | 'future'
      | 'missing'
      | 'existing'
      | 'firstSeason'
      | 'lastSeason'
      | 'latestSeason'
      | 'pilot'
      | 'recent'
      | 'monitorSpecials'
      | 'unmonitorSpecials'
      | 'none'
      | 'skip'
      | 'ep'
      | 'epfuture'
      | 'epseason';
    monitorNewItems: 'auto' | 'all' | 'none';
    episodeReadyTimeoutMs: number;
    episodeReadyPollMs: number;
    epCount: number;
    epCountPast: number;
    epCountMod: 'epfuture' | 'epseason';
    tags: number[];
    searchOnAdd: boolean;
  };
  traktSync: {
    enabled: boolean;
    syncMins: number;
    apiBaseUrl: string;
    clientId: string;
    clientSecret: string;
    refreshToken: string;
    redirectUri: string;
    stateFilePath: string;
  };
  tmdb: {
    apiBaseUrl: string;
    authToken: string;
    region: string;
  };
}

const LOG_LEVELS = new Set<LogLevel>(['debug', 'info', 'warn', 'error', 'none']);
export const DEFAULT_MANIFEST_LOGO_PATH = '/assets/logo.png';
const TARGET_CLIENTS = new Set<AppConfig['targetClient']>(['android-tv', 'generic']);
const FILE_STREAMING_PLAYBACK_MODES = new Set<AppConfig['fileStreaming']['playbackMode']>(['direct', 'kodi']);
const SONARR_MONITOR_NEW_ITEMS = new Set<AppConfig['sonarr']['monitorNewItems']>(['auto', 'all', 'none']);
const SONARR_MONITOR_ALIASES: Record<string, AppConfig['sonarr']['seriesMonitor']> = {
  all: 'all',
  future: 'future',
  missing: 'missing',
  existing: 'existing',
  firstseason: 'firstSeason',
  lastseason: 'lastSeason',
  latestseason: 'latestSeason',
  pilot: 'pilot',
  recent: 'recent',
  monitorspecials: 'monitorSpecials',
  unmonitorspecials: 'unmonitorSpecials',
  none: 'none',
  skip: 'skip',
  ep: 'ep',
  epfuture: 'epfuture',
  epseason: 'epseason'
};

function parseSonarrMonitorNewItems(value: string): AppConfig['sonarr']['monitorNewItems'] {
  const normalized = value.trim().toLowerCase() as AppConfig['sonarr']['monitorNewItems'];
  if (!SONARR_MONITOR_NEW_ITEMS.has(normalized)) {
    throw new Error('SONARR_MONITOR_NEW_ITEMS must be one of: auto, all, none.');
  }
  return normalized;
}

function parseEpCountMod(value: string): AppConfig['sonarr']['epCountMod'] {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'epfuture' || normalized === 'epseason') return normalized;
  throw new Error('EP_COUNT_MOD must be one of: epfuture, epseason.');
}

function parseEpCount(value: string): number {
  if (!value.trim()) return 0;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error('EP_COUNT must be a number.');
  }
  return Math.max(0, Math.floor(parsed));
}

function parseEpCountPast(value: string): number {
  if (!value.trim()) return 8;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error('EP_COUNT_PAST must be a number.');
  }
  return Math.max(1, Math.floor(parsed));
}

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
  const val = raw.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(val)) return true;
  if (['0', 'false', 'no', 'off'].includes(val)) return false;
  throw new Error(`Environment variable ${name} must be a boolean.`);
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

function readIntegerListEnv(name: string): number[] {
  return readString(name)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const n = Number(item);
      if (!Number.isInteger(n)) {
        throw new Error(`Environment variable ${name} must be a comma-separated list of integers.`);
      }
      return n;
    });
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

function ensureHttpsLogoUrl(name: string, value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`Environment variable ${name} must be a valid URL.`);
  }
  if (parsed.protocol !== 'https:') {
    throw new Error(`Environment variable ${name} must start with https://.`);
  }
  if (parsed.username || parsed.password) {
    throw new Error(`Environment variable ${name} must not contain embedded credentials (userinfo).`);
  }
  return parsed.toString();
}

export function buildDefaultManifestLogoUrl(publicBaseUrl: string, version: string): string {
  const logoUrl = new URL(DEFAULT_MANIFEST_LOGO_PATH, `${publicBaseUrl}/`);
  logoUrl.searchParams.set('v', version);
  return logoUrl.toString();
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

function parseSonarrSeriesMonitor(value: string): AppConfig['sonarr']['seriesMonitor'] {
  const normalized = value.trim().toLowerCase();
  const resolved = SONARR_MONITOR_ALIASES[normalized];
  if (!resolved) {
    throw new Error('SONARR_SERIES_MONITOR must be one of: all, future, missing, existing, firstSeason, lastSeason, latestSeason, pilot, recent, monitorSpecials, unmonitorSpecials, none, skip, ep, epfuture, epseason.');
  }
  return resolved;
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

function readVersionFromPackageJson(): string | undefined {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [process.cwd(), here, path.resolve(here, '..'), path.resolve(here, '../..'), path.resolve(here, '../../..')];
  for (const baseDir of candidates) {
    try {
      const raw = fs.readFileSync(path.join(baseDir, 'package.json'), 'utf8');
      const parsed = JSON.parse(raw) as { version?: unknown };
      if (typeof parsed.version === 'string' && parsed.version.trim()) {
        return parsed.version.trim();
      }
    } catch {
      continue;
    }
  }
  return undefined;
}

function resolveVersion(): string {
  const appVersion = readString('APP_VERSION');
  // Legacy installs may carry forward this old sample value from early .env templates.
  // Treat it as unset so runtime version stays aligned with package/release versioning.
  if (appVersion && appVersion !== '0.1.1') return appVersion;
  const npmPackageVersion = process.env.npm_package_version?.trim();
  if (npmPackageVersion) return npmPackageVersion;
  return readVersionFromPackageJson() ?? '0.1.0';
}


function loadCoreRuntimeConfig(packageVersion: string, publicBaseUrl: string) {
  const host = readString('HOST', '127.0.0.1');
  const port = readNumber('PORT', 7010);
  const manifestLogoEnv = readString('MANIFEST_LOGO_URL', 'local');
  const normalizedManifestLogo = manifestLogoEnv.toLowerCase();
  const manifestLogoUrl = normalizedManifestLogo === 'none'
    ? ''
    : (normalizedManifestLogo === 'local'
      ? buildDefaultManifestLogoUrl(publicBaseUrl, packageVersion)
      : ensureHttpsLogoUrl('MANIFEST_LOGO_URL', manifestLogoEnv));
  const targetClient = parseTargetClient(readString('TARGET_CLIENT', 'android-tv'));
  const timeZone = readString('TZ', Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
  const requestTimeoutMs = readNumber('REQUEST_TIMEOUT_MS', 5000);
  const gracefulShutdownTimeoutMs = readNumber('GRACEFUL_SHUTDOWN_TIMEOUT_MS', 10_000);
  const forcedShutdownExitCodeRaw = readNumber('FORCED_SHUTDOWN_EXIT_CODE', 0);

  if (requestTimeoutMs < 1000) throw new Error('REQUEST_TIMEOUT_MS must be at least 1000.');
  if (gracefulShutdownTimeoutMs < 1000) throw new Error('GRACEFUL_SHUTDOWN_TIMEOUT_MS must be at least 1000.');
  if (forcedShutdownExitCodeRaw !== 0 && forcedShutdownExitCodeRaw !== 1) {
    throw new Error('FORCED_SHUTDOWN_EXIT_CODE must be 0 or 1.');
  }
  const logLevelRaw = readString('LOG_LEVEL', 'info') as LogLevel;
  if (!LOG_LEVELS.has(logLevelRaw)) {
    throw new Error('LOG_LEVEL must be one of: debug, info, warn, error, none.');
  }

  return {
    host,
    port,
    manifestLogoUrl,
    targetClient,
    timeZone,
    requestTimeoutMs,
    gracefulShutdownTimeoutMs,
    forcedShutdownExitCode: forcedShutdownExitCodeRaw as 0 | 1,
    logLevel: logLevelRaw
  };
}

function loadCacheConfig() {
  const statusCacheTtlMs = readNumber('STATUS_CACHE_TTL_MS', 30000);
  const serviceHealthCacheTtlMs = readNumber('SERVICE_HEALTH_CACHE_TTL_MS', 10000);
  const streamCacheMaxAgeSec = readNumber('STREAM_CACHE_MAX_AGE', 2);
  const streamStaleRevalidateSec = readNumber('STREAM_STALE_REVALIDATE', 5);
  const catalogPageSize = readNumber('CATALOG_PAGE_SIZE', 35);
  const radarrCatalogWatchedKeepCount = readNumber('RADARR_CATALOG_WATCHED_KEEP_COUNT', 1);
  const catalogCacheTtlMs = readNumber('CATALOG_CACHE_TTL_MS', 5000);
  const catalogCacheMaxAgeSec = readNumber('CATALOG_CACHE_MAX_AGE_SEC', 15);
  const catalogStaleRevalidateSec = readNumber('CATALOG_STALE_REVALIDATE_SEC', 60);
  const catalogStaleErrorSec = readNumber('CATALOG_STALE_ERROR_SEC', 120);

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
  if (!Number.isInteger(radarrCatalogWatchedKeepCount) || radarrCatalogWatchedKeepCount < 0) {
    throw new Error('RADARR_CATALOG_WATCHED_KEEP_COUNT must be an integer greater than or equal to 0.');
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

  return {
    statusCacheTtlMs,
    serviceHealthCacheTtlMs,
    streamCacheMaxAgeSec,
    streamStaleRevalidateSec,
    catalogPageSize,
    radarrCatalogWatchedKeepCount,
    catalogCacheTtlMs,
    catalogCacheMaxAgeSec,
    catalogStaleRevalidateSec,
    catalogStaleErrorSec
  };
}

function loadFileStreamingConfig(): AppConfig['fileStreaming'] {
  const fileStreamingEnabled = readBoolean('FILE_STREAMING_ENABLED', false);
  const fileStreamingSecret = readString('FILE_STREAMING_SECRET');
  const fileStreamingPlaybackMode = parseFileStreamingPlaybackMode(
    readString('FILE_STREAMING_PLAYBACK_MODE', fileStreamingEnabled ? 'direct' : 'kodi')
  );
  if (fileStreamingEnabled && !fileStreamingSecret) {
    throw new Error('FILE_STREAMING_SECRET is required when FILE_STREAMING_ENABLED=true.');
  }
  return {
    enabled: fileStreamingEnabled,
    secret: fileStreamingSecret,
    playbackMode: fileStreamingPlaybackMode
  };
}

function loadKodiConfig(): AppConfig['kodi'] {
  const enabled = readBoolean('KODI_ENABLED', false);
  const packageName = readString('KODI_PACKAGE', 'org.xbmc.kodi');
  if (enabled && !packageName) {
    throw new Error('KODI_PACKAGE must not be empty.');
  }
  return { enabled, packageName };
}

function loadRadarrConfig(): AppConfig['radarr'] {
  const config = {
    enabled: readBoolean('RADARR_ENABLED', false),
    baseUrl: stripTrailingSlash(readString('RADARR_BASE_URL')),
    cardUrl: stripTrailingSlash(readString('RADARR_CARD_URL')),
    apiKey: readString('RADARR_API_KEY'),
    rootFolderPath: readString('RADARR_ROOT_FOLDER_PATH'),
    qualityProfileId: readNumber('RADARR_QUALITY_PROFILE_ID', 1),
    minimumAvailability: readString('RADARR_MINIMUM_AVAILABILITY', 'announced'),
    tags: readIntegerListEnv('RADARR_TAGS'),
    searchOnAdd: readBoolean('RADARR_SEARCH_ON_ADD', true),
    strictImdbMatch: readBoolean('RADARR_STRICT_IMDB_MATCH', false)
  };

  if (config.enabled && (!config.baseUrl || !config.apiKey)) {
    readRequiredString('RADARR_BASE_URL');
    readRequiredString('RADARR_API_KEY');
  }

  if (config.enabled) {
    readRequiredString('RADARR_ROOT_FOLDER_PATH');
    if (config.qualityProfileId <= 0) {
      throw new Error('RADARR_QUALITY_PROFILE_ID must be greater than 0.');
    }
  }

  return config;
}

function loadSonarrConfig(): AppConfig['sonarr'] {
  const sonarrEnabled = readBoolean('SONARR_ENABLED', false);
  const config: AppConfig['sonarr'] = {
    enabled: sonarrEnabled,
    baseUrl: stripTrailingSlash(readString('SONARR_BASE_URL')),
    cardUrl: stripTrailingSlash(readString('SONARR_CARD_URL')),
    apiKey: readString('SONARR_API_KEY'),
    rootFolderPath: readString('SONARR_ROOT_FOLDER_PATH'),
    qualityProfileId: readNumber('SONARR_QUALITY_PROFILE_ID', 1),
    languageProfileId: (() => {
      const raw = readNumber('SONARR_LANGUAGE_PROFILE_ID', 0);
      return raw > 0 ? raw : null;
    })(),
    seriesMonitor: sonarrEnabled
      ? parseSonarrSeriesMonitor(readString('SONARR_SERIES_MONITOR', 'all'))
      : 'all',
    monitorNewItems: parseSonarrMonitorNewItems(readString('SONARR_MONITOR_NEW_ITEMS', 'auto')),
    episodeReadyTimeoutMs: Math.max(1000, Math.floor(readNumber('SONARR_EPISODE_READY_TIMEOUT_MS', 60000))),
    episodeReadyPollMs: Math.max(250, Math.floor(readNumber('SONARR_EPISODE_READY_POLL_MS', 1500))),
    epCount: parseEpCount(readString('EP_COUNT', '2')),
    epCountPast: parseEpCountPast(readString('EP_COUNT_PAST', '8')),
    epCountMod: parseEpCountMod(readString('EP_COUNT_MOD', 'epfuture')),
    tags: readIntegerListEnv('SONARR_TAGS'),
    searchOnAdd: readBoolean('SONARR_SEARCH_ON_ADD', true)
  };

  if (config.enabled && (!config.baseUrl || !config.apiKey)) {
    readRequiredString('SONARR_BASE_URL');
    readRequiredString('SONARR_API_KEY');
  }

  if (config.enabled) {
    readRequiredString('SONARR_ROOT_FOLDER_PATH');
    if (config.qualityProfileId <= 0) {
      throw new Error('SONARR_QUALITY_PROFILE_ID must be greater than 0.');
    }
    if (config.episodeReadyPollMs > config.episodeReadyTimeoutMs) {
      throw new Error('SONARR_EPISODE_READY_POLL_MS must be less than or equal to SONARR_EPISODE_READY_TIMEOUT_MS.');
    }
  }

  return config;
}

function loadTraktSyncConfig(): AppConfig['traktSync'] {
  const traktSyncEnabled = readBoolean('TRAKT_SYNC_ENABLED', false);
  const traktSyncMinsRaw = Math.floor(readNumber('TRAKT_SYNC_MINS', 360));
  const config = {
    enabled: traktSyncEnabled,
    syncMins: traktSyncMinsRaw,
    apiBaseUrl: ensureHttpUrl('TRAKT_API_BASE_URL', readString('TRAKT_API_BASE_URL', 'https://api.trakt.tv')),
    clientId: readString('TRAKT_CLIENT_ID'),
    clientSecret: readString('TRAKT_CLIENT_SECRET'),
    refreshToken: readString('TRAKT_REFRESH_TOKEN'),
    redirectUri: readString('TRAKT_REDIRECT_URI', 'urn:ietf:wg:oauth:2.0:oob'),
    stateFilePath: readString('TRAKT_SYNC_STATE_FILE', path.resolve(process.cwd(), 'data/trakt-sync-state.json'))
  };

  if (config.enabled) {
    readRequiredString('TRAKT_CLIENT_ID');
    readRequiredString('TRAKT_CLIENT_SECRET');
    readRequiredString('TRAKT_REFRESH_TOKEN');
    if (config.syncMins < 40) throw new Error('TRAKT_SYNC_MINS must be at least 40.');
  }

  return config;
}

function loadTmdbConfig(): AppConfig['tmdb'] {
  return {
    apiBaseUrl: ensureHttpUrl('TMDB_API_BASE_URL', readString('TMDB_API_BASE_URL', 'https://api.themoviedb.org')),
    authToken: readString('TMDB_API_READ_ACCESS_TOKEN') || readString('TMDB_API_KEY'),
    region: readString('TMDB_RELEASE_REGION', 'US').toUpperCase()
  };
}

function normaliseEnabledServiceUrls(config: AppConfig) {
  if (config.radarr.enabled) {
    config.radarr.baseUrl = ensureHttpUrl('RADARR_BASE_URL', config.radarr.baseUrl);
    if (config.radarr.cardUrl) {
      config.radarr.cardUrl = stripTrailingSlash(config.radarr.cardUrl);
    } else {
      config.radarr.cardUrl = config.radarr.baseUrl;
    }
  }
  if (config.sonarr.enabled) {
    config.sonarr.baseUrl = ensureHttpUrl('SONARR_BASE_URL', config.sonarr.baseUrl);
    if (config.sonarr.cardUrl) {
      config.sonarr.cardUrl = stripTrailingSlash(config.sonarr.cardUrl);
    } else {
      config.sonarr.cardUrl = config.sonarr.baseUrl;
    }
  }
}

export function loadConfig(): AppConfig {
  const packageVersion = resolveVersion();
  const publicBaseUrl = ensureHttpUrl('PUBLIC_BASE_URL', readRequiredString('PUBLIC_BASE_URL'));

  const coreRuntime = loadCoreRuntimeConfig(packageVersion, publicBaseUrl);
  const cacheConfig = loadCacheConfig();
  const fileStreaming = loadFileStreamingConfig();
  const kodi = loadKodiConfig();
  const radarr = loadRadarrConfig();
  const sonarr = loadSonarrConfig();
  const traktSync = loadTraktSyncConfig();
  const tmdb = loadTmdbConfig();

  const config: AppConfig = {
    appName: 'stremio-addarr',
    version: packageVersion,
    publicBaseUrl,
    ...coreRuntime,
    ...cacheConfig,
    fileStreaming,
    kodi,
    radarr,
    sonarr,
    traktSync,
    tmdb
  };

  normaliseEnabledServiceUrls(config);

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
