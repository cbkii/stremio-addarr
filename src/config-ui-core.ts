import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import type { AppConfig } from './config.js';
import { addonBasePath, addonManifestUrl, stremioInstallUrl } from './lib/addon-access.js';
import type { Logger } from './logger.js';
import type { ArrStatusService } from './services/status.js';

const SESSION_COOKIE = 'addarr_config_session';
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 5 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 8;
const CONTROL_WINDOW_MS = 60_000;
const CONTROL_MAX_REQUESTS = 60;
const WRITE_QUEUE_MAX = 4;
const JSON_LIMIT = '64kb';

interface Session {
  csrf: string;
  expiresAt: number;
  controlCount: number;
  controlResetAt: number;
}

interface LoginWindow {
  count: number;
  resetAt: number;
}

interface ArrProbeInput {
  baseUrl: string;
  apiKey: string;
}

interface UiConfigPayload {
  catalog: {
    pageSize: number;
    watchedKeepCount: number;
  };
  radarr: {
    enabled: boolean;
    baseUrl: string;
    cardUrl: string;
    apiKey?: string;
    rootFolderPath: string;
    qualityProfileId: number;
    minimumAvailability: string;
    tags: string;
    searchOnAdd: boolean;
    strictImdbMatch: boolean;
  };
  sonarr: {
    enabled: boolean;
    baseUrl: string;
    cardUrl: string;
    apiKey?: string;
    rootFolderPath: string;
    qualityProfileId: number;
    languageProfileId: number | null;
    seriesMonitor: AppConfig['sonarr']['seriesMonitor'];
    monitorNewItems: AppConfig['sonarr']['monitorNewItems'];
    episodeReadyTimeoutMs: number;
    episodeReadyPollMs: number;
    epCount: number;
    epCountPast: number;
    epCountMod: AppConfig['sonarr']['epCountMod'];
    tags: string;
    searchOnAdd: boolean;
  };
  playback: {
    kodiEnabled: boolean;
    kodiPackageName: string;
    fileStreamingEnabled: boolean;
    fileStreamingPlaybackMode: AppConfig['fileStreaming']['playbackMode'];
  };
  trakt: {
    enabled: boolean;
    syncMins: number;
    apiBaseUrl: string;
    clientId?: string;
    clientSecret?: string;
    refreshToken?: string;
    redirectUri: string;
  };
  tmdb: {
    apiBaseUrl: string;
    authToken?: string;
    region: string;
  };
}

interface ConfigUiOptions {
  envFilePath?: string;
  adminToken?: string;
  controlRateLimitMax?: number;
  writeQueueMax?: number;
}

const MANAGED_KEYS = new Set([
  'CATALOG_PAGE_SIZE',
  'RADARR_CATALOG_WATCHED_KEEP_COUNT',
  'RADARR_ENABLED',
  'RADARR_BASE_URL',
  'RADARR_CARD_URL',
  'RADARR_API_KEY',
  'RADARR_ROOT_FOLDER_PATH',
  'RADARR_QUALITY_PROFILE_ID',
  'RADARR_MINIMUM_AVAILABILITY',
  'RADARR_TAGS',
  'RADARR_SEARCH_ON_ADD',
  'RADARR_STRICT_IMDB_MATCH',
  'SONARR_ENABLED',
  'SONARR_BASE_URL',
  'SONARR_CARD_URL',
  'SONARR_API_KEY',
  'SONARR_ROOT_FOLDER_PATH',
  'SONARR_QUALITY_PROFILE_ID',
  'SONARR_LANGUAGE_PROFILE_ID',
  'SONARR_SERIES_MONITOR',
  'SONARR_MONITOR_NEW_ITEMS',
  'SONARR_EPISODE_READY_TIMEOUT_MS',
  'SONARR_EPISODE_READY_POLL_MS',
  'EP_COUNT',
  'EP_COUNT_PAST',
  'EP_COUNT_MOD',
  'SONARR_TAGS',
  'SONARR_SEARCH_ON_ADD',
  'KODI_ENABLED',
  'KODI_PACKAGE',
  'FILE_STREAMING_ENABLED',
  'FILE_STREAMING_PLAYBACK_MODE',
  'TRAKT_SYNC_ENABLED',
  'TRAKT_SYNC_MINS',
  'TRAKT_API_BASE_URL',
  'TRAKT_CLIENT_ID',
  'TRAKT_CLIENT_SECRET',
  'TRAKT_REFRESH_TOKEN',
  'TRAKT_REDIRECT_URI',
  'TMDB_API_READ_ACCESS_TOKEN',
  'TMDB_API_BASE_URL',
  'TMDB_RELEASE_REGION'
]);

const SONARR_MONITORS = new Set<AppConfig['sonarr']['seriesMonitor']>([
  'all', 'future', 'missing', 'existing', 'firstSeason', 'lastSeason',
  'latestSeason', 'pilot', 'recent', 'monitorSpecials', 'unmonitorSpecials',
  'none', 'skip', 'ep', 'epfuture', 'epseason'
]);
const SONARR_NEW_ITEMS = new Set<AppConfig['sonarr']['monitorNewItems']>(['auto', 'all', 'none']);
const EP_COUNT_MODES = new Set<AppConfig['sonarr']['epCountMod']>(['epfuture', 'epseason']);
const PLAYBACK_MODES = new Set<AppConfig['fileStreaming']['playbackMode']>(['direct', 'kodi']);

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function parseCookies(req: Request): Map<string, string> {
  const result = new Map<string, string>();
  for (const item of (req.headers.cookie ?? '').split(';')) {
    const separator = item.indexOf('=');
    if (separator <= 0) continue;
    const key = item.slice(0, separator).trim();
    const value = item.slice(separator + 1).trim();
    if (!key) continue;
    try { result.set(key, decodeURIComponent(value)); } catch { /* ignore malformed cookies */ }
  }
  return result;
}

function secureEqual(actual: string, expected: string): boolean {
  const actualHash = createHash('sha256').update(actual).digest();
  const expectedHash = createHash('sha256').update(expected).digest();
  return timingSafeEqual(actualHash, expectedHash);
}

function normalizeHttpUrl(value: unknown, label: string, allowEmpty = false): string {
  const raw = typeof value === 'string' ? value.trim().replace(/\/+$/, '') : '';
  if (!raw && allowEmpty) return '';
  if (!raw) throw new Error(`${label} is required.`);
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`${label} must be a valid HTTP or HTTPS URL.`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`${label} must use HTTP or HTTPS.`);
  }
  if (parsed.username || parsed.password) throw new Error(`${label} must not contain credentials.`);
  if (parsed.search || parsed.hash) throw new Error(`${label} must not contain a query string or fragment.`);
  return parsed.toString().replace(/\/$/, '');
}

function readRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function readStringField(record: Record<string, unknown>, key: string, fallback = ''): string {
  const value = record[key];
  if (value == null) return fallback;
  if (typeof value !== 'string') throw new Error(`${key} must be a string.`);
  return value.trim();
}

function readBooleanField(record: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const value = record[key];
  if (value == null) return fallback;
  if (typeof value !== 'boolean') throw new Error(`${key} must be a boolean.`);
  return value;
}

function readIntegerField(
  record: Record<string, unknown>,
  key: string,
  fallback: number,
  min: number,
  max = Number.MAX_SAFE_INTEGER
): number {
  const value = record[key] ?? fallback;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${key} must be an integer between ${min} and ${max}.`);
  }
  return value;
}

function normalizeTags(value: unknown, label: string): string {
  if (typeof value === 'string' && value.trim() === '') return '';
  const parts = Array.isArray(value)
    ? value
    : (typeof value === 'string' ? value.split(',') : []);
  const tags = parts
    .map((item) => typeof item === 'number' ? item : Number(String(item).trim()))
    .filter((item) => Number.isFinite(item));
  if (parts.length !== tags.length || tags.some((item) => !Number.isInteger(item) || item < 0)) {
    throw new Error(`${label} must be a comma-separated list of non-negative integer IDs.`);
  }
  return tags.join(',');
}

function parseBoolean(raw: string | undefined, fallback: boolean): boolean {
  if (raw == null) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase());
}

function parseInteger(raw: string | undefined, fallback: number): number {
  if (raw == null || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? Math.floor(parsed) : fallback;
}

function decodeEnvValue(raw: string): string {
  const value = raw.trim();
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value) as string;
    } catch {
      return value.slice(1, -1);
    }
  }
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1);
  return value.replace(/\s+#.*$/, '').trim();
}

function parseEnv(content: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const line of content.split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    result.set(match[1], decodeEnvValue(match[2]));
  }
  return result;
}

function encodeEnvValue(value: string): string {
  if (/^[A-Za-z0-9_./,:@+\-]*$/.test(value)) return value;
  return JSON.stringify(value);
}

function updateEnvContent(content: string, updates: Map<string, string>): string {
  const remaining = new Map(updates);
  const lines = content ? content.split(/\r?\n/) : [];
  const updated = lines.map((line) => {
    const match = /^(\s*(?:export\s+)?)([A-Z][A-Z0-9_]*)\s*=/.exec(line);
    if (!match || !updates.has(match[2])) return line;
    const value = updates.get(match[2]) ?? '';
    remaining.delete(match[2]);
    return `${match[1]}${match[2]}=${encodeEnvValue(value)}`;
  });
  if (remaining.size > 0) {
    if (updated.length > 0 && updated[updated.length - 1] !== '') updated.push('');
    updated.push('# Managed by the stremio-addarr configuration UI');
    for (const [key, value] of remaining) updated.push(`${key}=${encodeEnvValue(value)}`);
  }
  while (updated.length > 1 && updated[updated.length - 1] === '' && updated[updated.length - 2] === '') {
    updated.pop();
  }
  return `${updated.join('\n')}\n`;
}

async function readEnvFile(envFile: string): Promise<{ raw: string; values: Map<string, string> }> {
  try {
    const raw = await fs.readFile(envFile, 'utf8');
    return { raw, values: parseEnv(raw) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { raw: '', values: new Map() };
    throw error;
  }
}

async function atomicWriteEnv(envFile: string, raw: string): Promise<void> {
  const directory = path.dirname(envFile);
  await fs.mkdir(directory, { recursive: true });
  const temp = `${envFile}.tmp-${process.pid}-${randomUUID()}`;
  const backup = `${envFile}.bak`;
  try {
    try {
      await fs.copyFile(envFile, backup);
      await fs.chmod(backup, 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const handle = await fs.open(temp, 'w', 0o600);
    try {
      await handle.writeFile(raw, { encoding: 'utf8' });
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.rename(temp, envFile);
    await fs.chmod(envFile, 0o600);
    const directoryHandle = await fs.open(directory, 'r');
    try { await directoryHandle.sync(); } finally { await directoryHandle.close(); }
  } finally {
    await fs.rm(temp, { force: true }).catch(() => undefined);
  }
}

function pendingValue(values: Map<string, string>, key: string, fallback: string): string {
  return values.get(key) ?? fallback;
}

function buildViewModel(config: AppConfig, pending: Map<string, string>) {
  const languageProfileRaw = pendingValue(pending, 'SONARR_LANGUAGE_PROFILE_ID', String(config.sonarr.languageProfileId ?? 0));
  const languageProfileId = parseInteger(languageProfileRaw, config.sonarr.languageProfileId ?? 0);
  return {
    app: {
      name: config.appName,
      version: config.version,
      publicBaseUrl: config.publicBaseUrl,
      manifestUrl: addonManifestUrl(config),
      stremioUrl: stremioInstallUrl(config),
      restartRequiredAfterSave: true
    },
    bootstrap: {
      host: config.host,
      port: config.port,
      targetClient: config.targetClient,
      timeZone: config.timeZone,
      envFileManaged: true
    },
    catalog: {
      pageSize: parseInteger(pending.get('CATALOG_PAGE_SIZE'), config.catalogPageSize),
      watchedKeepCount: parseInteger(pending.get('RADARR_CATALOG_WATCHED_KEEP_COUNT'), config.radarrCatalogWatchedKeepCount)
    },
    radarr: {
      enabled: parseBoolean(pending.get('RADARR_ENABLED'), config.radarr.enabled),
      baseUrl: pendingValue(pending, 'RADARR_BASE_URL', config.radarr.baseUrl),
      cardUrl: pendingValue(pending, 'RADARR_CARD_URL', config.radarr.cardUrl),
      apiKeyConfigured: Boolean(pending.get('RADARR_API_KEY') || config.radarr.apiKey),
      rootFolderPath: pendingValue(pending, 'RADARR_ROOT_FOLDER_PATH', config.radarr.rootFolderPath),
      qualityProfileId: parseInteger(pending.get('RADARR_QUALITY_PROFILE_ID'), config.radarr.qualityProfileId),
      minimumAvailability: pendingValue(pending, 'RADARR_MINIMUM_AVAILABILITY', config.radarr.minimumAvailability),
      tags: pendingValue(pending, 'RADARR_TAGS', config.radarr.tags.join(',')),
      searchOnAdd: parseBoolean(pending.get('RADARR_SEARCH_ON_ADD'), config.radarr.searchOnAdd),
      strictImdbMatch: parseBoolean(pending.get('RADARR_STRICT_IMDB_MATCH'), config.radarr.strictImdbMatch)
    },
    sonarr: {
      enabled: parseBoolean(pending.get('SONARR_ENABLED'), config.sonarr.enabled),
      baseUrl: pendingValue(pending, 'SONARR_BASE_URL', config.sonarr.baseUrl),
      cardUrl: pendingValue(pending, 'SONARR_CARD_URL', config.sonarr.cardUrl),
      apiKeyConfigured: Boolean(pending.get('SONARR_API_KEY') || config.sonarr.apiKey),
      rootFolderPath: pendingValue(pending, 'SONARR_ROOT_FOLDER_PATH', config.sonarr.rootFolderPath),
      qualityProfileId: parseInteger(pending.get('SONARR_QUALITY_PROFILE_ID'), config.sonarr.qualityProfileId),
      languageProfileId: languageProfileId > 0 ? languageProfileId : null,
      seriesMonitor: pendingValue(pending, 'SONARR_SERIES_MONITOR', config.sonarr.seriesMonitor),
      monitorNewItems: pendingValue(pending, 'SONARR_MONITOR_NEW_ITEMS', config.sonarr.monitorNewItems),
      episodeReadyTimeoutMs: parseInteger(pending.get('SONARR_EPISODE_READY_TIMEOUT_MS'), config.sonarr.episodeReadyTimeoutMs),
      episodeReadyPollMs: parseInteger(pending.get('SONARR_EPISODE_READY_POLL_MS'), config.sonarr.episodeReadyPollMs),
      epCount: parseInteger(pending.get('EP_COUNT'), config.sonarr.epCount),
      epCountPast: parseInteger(pending.get('EP_COUNT_PAST'), config.sonarr.epCountPast),
      epCountMod: pendingValue(pending, 'EP_COUNT_MOD', config.sonarr.epCountMod),
      tags: pendingValue(pending, 'SONARR_TAGS', config.sonarr.tags.join(',')),
      searchOnAdd: parseBoolean(pending.get('SONARR_SEARCH_ON_ADD'), config.sonarr.searchOnAdd)
    },
    playback: {
      kodiEnabled: parseBoolean(pending.get('KODI_ENABLED'), config.kodi.enabled),
      kodiPackageName: pendingValue(pending, 'KODI_PACKAGE', config.kodi.packageName),
      fileStreamingEnabled: parseBoolean(pending.get('FILE_STREAMING_ENABLED'), config.fileStreaming.enabled),
      fileStreamingSecretConfigured: Boolean(process.env['FILE_STREAMING_SECRET'] || config.fileStreaming.secret),
      fileStreamingPlaybackMode: pendingValue(pending, 'FILE_STREAMING_PLAYBACK_MODE', config.fileStreaming.playbackMode)
    },
    trakt: {
      enabled: parseBoolean(pending.get('TRAKT_SYNC_ENABLED'), config.traktSync.enabled),
      syncMins: parseInteger(pending.get('TRAKT_SYNC_MINS'), config.traktSync.syncMins),
      apiBaseUrl: pendingValue(pending, 'TRAKT_API_BASE_URL', config.traktSync.apiBaseUrl),
      clientIdConfigured: Boolean(pending.get('TRAKT_CLIENT_ID') || config.traktSync.clientId),
      clientSecretConfigured: Boolean(pending.get('TRAKT_CLIENT_SECRET') || config.traktSync.clientSecret),
      refreshTokenConfigured: Boolean(pending.get('TRAKT_REFRESH_TOKEN') || config.traktSync.refreshToken),
      redirectUri: pendingValue(pending, 'TRAKT_REDIRECT_URI', config.traktSync.redirectUri)
    },
    tmdb: {
      apiBaseUrl: pendingValue(pending, 'TMDB_API_BASE_URL', config.tmdb.apiBaseUrl),
      authTokenConfigured: Boolean(pending.get('TMDB_API_READ_ACCESS_TOKEN') || config.tmdb.authToken),
      region: pendingValue(pending, 'TMDB_RELEASE_REGION', config.tmdb.region)
    }
  };
}

function payloadToUpdates(body: unknown, config: AppConfig, currentEnv: Map<string, string>): Map<string, string> {
  const root = readRecord(body, 'Configuration');
  const catalog = readRecord(root['catalog'], 'catalog');
  const radarr = readRecord(root['radarr'], 'radarr');
  const sonarr = readRecord(root['sonarr'], 'sonarr');
  const playback = readRecord(root['playback'], 'playback');
  const trakt = readRecord(root['trakt'], 'trakt');
  const tmdb = readRecord(root['tmdb'], 'tmdb');

  const updates = new Map<string, string>();
  const set = (key: string, value: string | number | boolean) => {
    if (!MANAGED_KEYS.has(key)) throw new Error(`Unsupported configuration key: ${key}`);
    updates.set(key, String(value));
  };

  set('CATALOG_PAGE_SIZE', readIntegerField(catalog, 'pageSize', config.catalogPageSize, 10, 100));
  set('RADARR_CATALOG_WATCHED_KEEP_COUNT', readIntegerField(catalog, 'watchedKeepCount', config.radarrCatalogWatchedKeepCount, 0, 50));

  const radarrEnabled = readBooleanField(radarr, 'enabled', config.radarr.enabled);
  const radarrBaseUrl = normalizeHttpUrl(radarr['baseUrl'], 'Radarr server URL', !radarrEnabled);
  const radarrRoot = readStringField(radarr, 'rootFolderPath', config.radarr.rootFolderPath);
  const radarrNewKey = readStringField(radarr, 'apiKey');
  const radarrKeyConfigured = Boolean(radarrNewKey || currentEnv.get('RADARR_API_KEY') || config.radarr.apiKey);
  if (radarrEnabled && !radarrRoot) throw new Error('Radarr root folder is required when Radarr is enabled.');
  if (radarrEnabled && !radarrKeyConfigured) throw new Error('Radarr API key is required when Radarr is enabled.');
  set('RADARR_ENABLED', radarrEnabled);
  set('RADARR_BASE_URL', radarrBaseUrl);
  set('RADARR_CARD_URL', readStringField(radarr, 'cardUrl', config.radarr.cardUrl).replace(/\/+$/, ''));
  if (radarrNewKey) set('RADARR_API_KEY', radarrNewKey);
  set('RADARR_ROOT_FOLDER_PATH', radarrRoot);
  set('RADARR_QUALITY_PROFILE_ID', readIntegerField(radarr, 'qualityProfileId', config.radarr.qualityProfileId, 1));
  set('RADARR_MINIMUM_AVAILABILITY', readStringField(radarr, 'minimumAvailability', config.radarr.minimumAvailability) || 'announced');
  set('RADARR_TAGS', normalizeTags(radarr['tags'], 'Radarr tags'));
  set('RADARR_SEARCH_ON_ADD', readBooleanField(radarr, 'searchOnAdd', config.radarr.searchOnAdd));
  set('RADARR_STRICT_IMDB_MATCH', readBooleanField(radarr, 'strictImdbMatch', config.radarr.strictImdbMatch));

  const sonarrEnabled = readBooleanField(sonarr, 'enabled', config.sonarr.enabled);
  const sonarrBaseUrl = normalizeHttpUrl(sonarr['baseUrl'], 'Sonarr server URL', !sonarrEnabled);
  const sonarrRoot = readStringField(sonarr, 'rootFolderPath', config.sonarr.rootFolderPath);
  const sonarrNewKey = readStringField(sonarr, 'apiKey');
  const sonarrKeyConfigured = Boolean(sonarrNewKey || currentEnv.get('SONARR_API_KEY') || config.sonarr.apiKey);
  if (sonarrEnabled && !sonarrRoot) throw new Error('Sonarr root folder is required when Sonarr is enabled.');
  if (sonarrEnabled && !sonarrKeyConfigured) throw new Error('Sonarr API key is required when Sonarr is enabled.');
  const monitor = readStringField(sonarr, 'seriesMonitor', config.sonarr.seriesMonitor) as AppConfig['sonarr']['seriesMonitor'];
  const monitorNewItems = readStringField(sonarr, 'monitorNewItems', config.sonarr.monitorNewItems) as AppConfig['sonarr']['monitorNewItems'];
  const epCountMod = readStringField(sonarr, 'epCountMod', config.sonarr.epCountMod) as AppConfig['sonarr']['epCountMod'];
  if (!SONARR_MONITORS.has(monitor)) throw new Error('Invalid Sonarr monitoring mode.');
  if (!SONARR_NEW_ITEMS.has(monitorNewItems)) throw new Error('Invalid Sonarr new-items policy.');
  if (!EP_COUNT_MODES.has(epCountMod)) throw new Error('Invalid EP_COUNT_MOD value.');
  const episodeReadyTimeoutMs = readIntegerField(sonarr, 'episodeReadyTimeoutMs', config.sonarr.episodeReadyTimeoutMs, 1000);
  const episodeReadyPollMs = readIntegerField(sonarr, 'episodeReadyPollMs', config.sonarr.episodeReadyPollMs, 250);
  if (episodeReadyPollMs > episodeReadyTimeoutMs) throw new Error('Sonarr episode poll interval must not exceed its timeout.');
  const languageProfileValue = sonarr['languageProfileId'];
  const languageProfileId = languageProfileValue == null ? 0 : readIntegerField(sonarr, 'languageProfileId', 0, 0);
  set('SONARR_ENABLED', sonarrEnabled);
  set('SONARR_BASE_URL', sonarrBaseUrl);
  set('SONARR_CARD_URL', readStringField(sonarr, 'cardUrl', config.sonarr.cardUrl).replace(/\/+$/, ''));
  if (sonarrNewKey) set('SONARR_API_KEY', sonarrNewKey);
  set('SONARR_ROOT_FOLDER_PATH', sonarrRoot);
  set('SONARR_QUALITY_PROFILE_ID', readIntegerField(sonarr, 'qualityProfileId', config.sonarr.qualityProfileId, 1));
  set('SONARR_LANGUAGE_PROFILE_ID', languageProfileId);
  set('SONARR_SERIES_MONITOR', monitor);
  set('SONARR_MONITOR_NEW_ITEMS', monitorNewItems);
  set('SONARR_EPISODE_READY_TIMEOUT_MS', episodeReadyTimeoutMs);
  set('SONARR_EPISODE_READY_POLL_MS', episodeReadyPollMs);
  set('EP_COUNT', readIntegerField(sonarr, 'epCount', config.sonarr.epCount, 0));
  set('EP_COUNT_PAST', readIntegerField(sonarr, 'epCountPast', config.sonarr.epCountPast, 1));
  set('EP_COUNT_MOD', epCountMod);
  set('SONARR_TAGS', normalizeTags(sonarr['tags'], 'Sonarr tags'));
  set('SONARR_SEARCH_ON_ADD', readBooleanField(sonarr, 'searchOnAdd', config.sonarr.searchOnAdd));

  const playbackMode = readStringField(playback, 'fileStreamingPlaybackMode', config.fileStreaming.playbackMode) as AppConfig['fileStreaming']['playbackMode'];
  if (!PLAYBACK_MODES.has(playbackMode)) throw new Error('Invalid file-streaming playback mode.');
  const streamingEnabled = readBooleanField(playback, 'fileStreamingEnabled', config.fileStreaming.enabled);
  if (streamingEnabled && !(process.env['FILE_STREAMING_SECRET'] || config.fileStreaming.secret)) {
    throw new Error('FILE_STREAMING_SECRET must be configured outside the UI before file streaming can be enabled.');
  }
  set('KODI_ENABLED', readBooleanField(playback, 'kodiEnabled', config.kodi.enabled));
  set('KODI_PACKAGE', readStringField(playback, 'kodiPackageName', config.kodi.packageName) || 'org.xbmc.kodi');
  set('FILE_STREAMING_ENABLED', streamingEnabled);
  set('FILE_STREAMING_PLAYBACK_MODE', playbackMode);

  const traktEnabled = readBooleanField(trakt, 'enabled', config.traktSync.enabled);
  const traktClientId = readStringField(trakt, 'clientId');
  const traktClientSecret = readStringField(trakt, 'clientSecret');
  const traktRefreshToken = readStringField(trakt, 'refreshToken');
  const hasClientId = Boolean(traktClientId || currentEnv.get('TRAKT_CLIENT_ID') || config.traktSync.clientId);
  const hasClientSecret = Boolean(traktClientSecret || currentEnv.get('TRAKT_CLIENT_SECRET') || config.traktSync.clientSecret);
  const hasRefreshToken = Boolean(traktRefreshToken || currentEnv.get('TRAKT_REFRESH_TOKEN') || config.traktSync.refreshToken);
  if (traktEnabled && (!hasClientId || !hasClientSecret || !hasRefreshToken)) {
    throw new Error('Trakt client ID, client secret and refresh token are required when Trakt sync is enabled.');
  }
  set('TRAKT_SYNC_ENABLED', traktEnabled);
  set('TRAKT_SYNC_MINS', readIntegerField(trakt, 'syncMins', config.traktSync.syncMins, 40));
  set('TRAKT_API_BASE_URL', normalizeHttpUrl(trakt['apiBaseUrl'], 'Trakt API URL'));
  if (traktClientId) set('TRAKT_CLIENT_ID', traktClientId);
  if (traktClientSecret) set('TRAKT_CLIENT_SECRET', traktClientSecret);
  if (traktRefreshToken) set('TRAKT_REFRESH_TOKEN', traktRefreshToken);
  set('TRAKT_REDIRECT_URI', readStringField(trakt, 'redirectUri', config.traktSync.redirectUri) || 'urn:ietf:wg:oauth:2.0:oob');

  set('TMDB_API_BASE_URL', normalizeHttpUrl(tmdb['apiBaseUrl'], 'TMDB API URL'));
  const tmdbToken = readStringField(tmdb, 'authToken');
  if (tmdbToken) set('TMDB_API_READ_ACCESS_TOKEN', tmdbToken);
  const tmdbRegion = readStringField(tmdb, 'region', config.tmdb.region).toUpperCase();
  if (!/^[A-Z]{2}$/.test(tmdbRegion)) throw new Error('TMDB region must be a two-letter country code.');
  set('TMDB_RELEASE_REGION', tmdbRegion);

  return updates;
}

async function fetchJson(url: string, init: RequestInit, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json() as unknown;
  } finally {
    clearTimeout(timeout);
  }
}

export function credentialForProbeOrigin(
  requestedBaseUrl: string,
  suppliedCredential: string,
  storedBaseUrl: string,
  storedCredential: string
): string {
  if (suppliedCredential) return suppliedCredential;
  try {
    return new URL(requestedBaseUrl).origin === new URL(storedBaseUrl).origin ? storedCredential : '';
  } catch {
    return '';
  }
}

function arrProbeInput(body: unknown, service: 'radarr' | 'sonarr', config: AppConfig, pending: Map<string, string>): ArrProbeInput {
  const record = readRecord(body, `${service} probe`);
  const isRadarr = service === 'radarr';
  const prefix = isRadarr ? 'RADARR' : 'SONARR';
  const current = isRadarr ? config.radarr : config.sonarr;
  const storedBaseUrl = pending.get(`${prefix}_BASE_URL`) || current.baseUrl;
  const baseUrl = normalizeHttpUrl(record['baseUrl'] ?? storedBaseUrl, `${service} server URL`);
  const suppliedKey = readStringField(record, 'apiKey');
  const storedKey = pending.get(`${prefix}_API_KEY`) || current.apiKey;
  const apiKey = credentialForProbeOrigin(baseUrl, suppliedKey, storedBaseUrl, storedKey);
  if (!apiKey) throw new Error(`${service} API key must be supplied when testing a different server origin.`);
  return { baseUrl, apiKey };
}

function asObjectArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
    : [];
}

function configureHtml(config: AppConfig, health: Awaited<ReturnType<ArrStatusService['getServiceHealth']>>, authEnabled: boolean): string {
  const manifestUrl = addonManifestUrl(config);
  const radarrState = health.radarr.reachable ? 'Connected' : (health.radarr.detail === 'disabled' ? 'Disabled' : 'Needs attention');
  const sonarrState = health.sonarr.reachable ? 'Connected' : (health.sonarr.detail === 'disabled' ? 'Disabled' : 'Needs attention');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <meta name="theme-color" content="#10131a">
  <title>Configure Arr Status &amp; Add</title>
  <link rel="stylesheet" href="/assets/configure.css?v=${encodeURIComponent(config.version)}">
</head>
<body>
  <main class="shell" data-auth-enabled="${authEnabled ? 'true' : 'false'}">
    <header class="hero">
      <img src="/assets/logo.png" alt="" class="logo">
      <div>
        <p class="eyebrow">STREMIO ADD-ON</p>
        <h1>Arr Status &amp; Add</h1>
        <p class="lede">Configure Radarr, Sonarr, catalogues and playback.</p>
      </div>
    </header>

    <section class="status-grid" aria-label="Current service status">
      <article class="status-card"><span>Radarr</span><strong>${escapeHtml(radarrState)}</strong></article>
      <article class="status-card"><span>Sonarr</span><strong>${escapeHtml(sonarrState)}</strong></article>
      <article class="status-card"><span>Manifest</span><strong>Ready</strong></article>
    </section>

    <section id="auth-panel" class="panel">
      <h2>Administrator access</h2>
      <p>${authEnabled
        ? 'Enter the configuration token from your server environment. It is never placed in the Stremio manifest URL.'
        : 'Editing is disabled until CONFIG_UI_TOKEN is set in the server environment and the service is restarted.'}</p>
      <form id="login-form" class="stack" ${authEnabled ? '' : 'hidden'}>
        <label for="admin-token">Configuration token</label>
        <input id="admin-token" name="token" type="password" autocomplete="current-password" required>
        <button type="submit" class="primary">Unlock configuration</button>
      </form>
      <p id="auth-message" class="message" role="status"></p>
    </section>

    <section id="dashboard" hidden>
      <nav class="step-nav" aria-label="Configuration sections">
        <button type="button" data-section="overview">Overview</button>
        <button type="button" data-section="arr">Radarr &amp; Sonarr</button>
        <button type="button" data-section="catalog">Catalogues</button>
        <button type="button" data-section="playback">Playback</button>
        <button type="button" data-section="integrations">Trakt &amp; TMDB</button>
      </nav>

      <form id="config-form">
        <section class="panel config-section" data-page="overview">
          <h2>Install and status</h2>
          <p><strong>Save server settings</strong> applies changes to this add-on after a service restart. Use <strong>Install / reinstall</strong> only for first-time installation or after changing the add-on access token.</p>
          <div class="actions">
            <a class="button" id="install-link" href="${escapeHtml(stremioInstallUrl(config))}">Install / reinstall in Stremio</a>
            <button type="button" id="copy-manifest">Copy manifest URL</button>
            <button type="button" id="logout">Lock dashboard</button>
          </div>
          <output id="manifest-url" class="code">${escapeHtml(manifestUrl)}</output>
          <div id="save-banner" class="message" role="status"></div>
        </section>

        <section class="panel config-section" data-page="arr" hidden>
          <h2>Radarr</h2>
          <div class="toggle-row"><label for="radarr-enabled">Enable Radarr</label><input id="radarr-enabled" type="checkbox"></div>
          <label for="radarr-url">Server URL</label><input id="radarr-url" inputmode="url" placeholder="http://127.0.0.1:7878">
          <label for="radarr-card-url">Display URL <span class="muted">optional</span></label><input id="radarr-card-url" inputmode="url">
          <label for="radarr-key">API key <span class="muted" id="radarr-key-state"></span></label><input id="radarr-key" type="password" autocomplete="new-password" placeholder="Leave blank to keep existing">
          <div class="actions"><button type="button" id="test-radarr">Test &amp; discover options</button></div>
          <p id="radarr-result" class="message" role="status"></p>
          <label for="radarr-root">Root folder</label><select id="radarr-root" data-free-entry="true"></select>
          <label for="radarr-profile">Quality profile</label><select id="radarr-profile"></select>
          <label for="radarr-minimum">Minimum availability</label>
          <select id="radarr-minimum"><option value="announced">Announced</option><option value="inCinemas">In cinemas</option><option value="released">Released</option><option value="preDB">PreDB</option></select>
          <label for="radarr-tags">Tag IDs</label><input id="radarr-tags" inputmode="numeric" placeholder="1,3">
          <div class="toggle-row"><label for="radarr-search">Search immediately after add</label><input id="radarr-search" type="checkbox"></div>
          <div class="toggle-row"><label for="radarr-strict">Require strict IMDb match</label><input id="radarr-strict" type="checkbox"></div>

          <hr>
          <h2>Sonarr</h2>
          <div class="toggle-row"><label for="sonarr-enabled">Enable Sonarr</label><input id="sonarr-enabled" type="checkbox"></div>
          <label for="sonarr-url">Server URL</label><input id="sonarr-url" inputmode="url" placeholder="http://127.0.0.1:8989">
          <label for="sonarr-card-url">Display URL <span class="muted">optional</span></label><input id="sonarr-card-url" inputmode="url">
          <label for="sonarr-key">API key <span class="muted" id="sonarr-key-state"></span></label><input id="sonarr-key" type="password" autocomplete="new-password" placeholder="Leave blank to keep existing">
          <div class="actions"><button type="button" id="test-sonarr">Test &amp; discover options</button></div>
          <p id="sonarr-result" class="message" role="status"></p>
          <label for="sonarr-root">Root folder</label><select id="sonarr-root" data-free-entry="true"></select>
          <label for="sonarr-profile">Quality profile</label><select id="sonarr-profile"></select>
          <label for="sonarr-language">Language profile <span class="muted">Sonarr v3 only</span></label><select id="sonarr-language"><option value="0">Not used</option></select>
          <label for="sonarr-monitor">Monitoring mode</label>
          <select id="sonarr-monitor">
            <option value="all">All episodes</option><option value="future">Future episodes</option><option value="missing">Missing episodes</option>
            <option value="existing">Existing episodes</option><option value="firstSeason">First season</option><option value="lastSeason">Last season</option>
            <option value="latestSeason">Latest season</option><option value="pilot">Pilot</option><option value="recent">Recent</option>
            <option value="none">None</option><option value="skip">Skip</option><option value="ep">Selected episode</option>
            <option value="epfuture">Selected and future</option><option value="epseason">Selected through season end</option>
          </select>
          <label for="sonarr-new-items">Monitor new items</label><select id="sonarr-new-items"><option value="auto">Automatic</option><option value="all">All</option><option value="none">None</option></select>
          <label for="sonarr-tags">Tag IDs</label><input id="sonarr-tags" inputmode="numeric" placeholder="1,3">
          <div class="toggle-row"><label for="sonarr-search">Search immediately after add</label><input id="sonarr-search" type="checkbox"></div>
          <details><summary>Advanced episode behaviour</summary>
            <label for="episode-timeout">Episode-ready timeout (ms)</label><input id="episode-timeout" type="number" min="1000" step="250">
            <label for="episode-poll">Episode-ready poll interval (ms)</label><input id="episode-poll" type="number" min="250" step="250">
            <label for="ep-count">Downloaded episode threshold</label><input id="ep-count" type="number" min="0">
            <label for="ep-count-past">Prior episodes inspected</label><input id="ep-count-past" type="number" min="1">
            <label for="ep-count-mod">Threshold upgrade mode</label><select id="ep-count-mod"><option value="epfuture">Selected and future</option><option value="epseason">Selected through season end</option></select>
          </details>
        </section>

        <section class="panel config-section" data-page="catalog" hidden>
          <h2>Stremio catalogues</h2>
          <label for="catalog-page-size">Cards per page</label><input id="catalog-page-size" type="number" min="10" max="100" step="1" aria-describedby="catalog-page-help">
          <p class="muted" id="catalog-page-help">How many cards the add-on builds per Stremio catalogue request. The default is 30; lower values reduce Pi and Arr load.</p>
          <label for="catalog-watched-keep">Recent watched movies kept visible</label><input id="catalog-watched-keep" type="number" min="0" max="50">
          <p class="muted">Use 0 to hide watched movies in filtered Radarr catalogue views.</p>
        </section>

        <section class="panel config-section" data-page="playback" hidden>
          <h2>Playback</h2>
          <div class="toggle-row"><label for="kodi-enabled">Enable Kodi fallback</label><input id="kodi-enabled" type="checkbox"></div>
          <label for="kodi-package">Kodi Android package</label><input id="kodi-package">
          <div class="toggle-row"><label for="streaming-enabled">Enable direct Pi file streaming</label><input id="streaming-enabled" type="checkbox"></div>
          <p class="muted" id="streaming-secret-state"></p>
          <label for="playback-mode">Preferred playback mode</label><select id="playback-mode"><option value="direct">Direct stream</option><option value="kodi">Kodi fallback</option></select>
        </section>

        <section class="panel config-section" data-page="integrations" hidden>
          <h2>Trakt watched sync</h2>
          <div class="toggle-row"><label for="trakt-enabled">Enable Trakt sync</label><input id="trakt-enabled" type="checkbox"></div>
          <label for="trakt-sync-mins">Sync interval (minutes)</label><input id="trakt-sync-mins" type="number" min="40">
          <label for="trakt-api-url">API URL</label><input id="trakt-api-url" inputmode="url">
          <label for="trakt-client-id">Client ID <span class="muted" id="trakt-client-id-state"></span></label><input id="trakt-client-id" type="password" placeholder="Leave blank to keep existing">
          <label for="trakt-client-secret">Client secret <span class="muted" id="trakt-client-secret-state"></span></label><input id="trakt-client-secret" type="password" placeholder="Leave blank to keep existing">
          <label for="trakt-refresh-token">Refresh token <span class="muted" id="trakt-refresh-state"></span></label><input id="trakt-refresh-token" type="password" placeholder="Leave blank to keep existing">
          <label for="trakt-redirect-uri">Redirect URI</label><input id="trakt-redirect-uri">
          <p class="muted">Trakt credentials are validated locally on save. The refresh flow runs after restart; the UI does not rotate tokens merely to test them.</p>

          <hr>
          <h2>TMDB fallback</h2>
          <label for="tmdb-api-url">API URL</label><input id="tmdb-api-url" inputmode="url">
          <label for="tmdb-token">Read access token <span class="muted" id="tmdb-token-state"></span></label><input id="tmdb-token" type="password" placeholder="Leave blank to keep existing">
          <label for="tmdb-region">Release region</label><input id="tmdb-region" maxlength="2" inputmode="text">
        </section>

        <footer class="save-bar">
          <button type="submit" class="primary" id="save-configuration">Save server settings</button>
          <span>Saves safely to the server. Restart the service when prompted; reinstalling in Stremio is normally unnecessary.</span>
        </footer>
      </form>
    </section>
  </main>
  <script type="module" src="/assets/configure.js?v=${encodeURIComponent(config.version)}"></script>
</body>
</html>`;
}

export function createConfigUiRouter(
  config: AppConfig,
  statusService: ArrStatusService,
  logger: Logger,
  options: ConfigUiOptions = {}
) {
  const router = express.Router();
  const envFile = path.resolve(options.envFilePath ?? process.env['CONFIG_UI_ENV_FILE'] ?? path.resolve(process.cwd(), '.env'));
  const adminToken = (options.adminToken ?? process.env['CONFIG_UI_TOKEN'] ?? '').trim();
  if (config.configUiEnabled && !/^[A-Za-z0-9_-]{8,128}$/.test(adminToken)) {
    throw new Error('CONFIG_UI_TOKEN must be 8-128 URL-safe characters when CONFIG_UI_ENABLED=true.');
  }
  const authEnabled = config.configUiEnabled;
  const controlRateLimitMax = options.controlRateLimitMax ?? CONTROL_MAX_REQUESTS;
  const writeQueueMax = options.writeQueueMax ?? WRITE_QUEUE_MAX;
  const secureCookie = new URL(config.publicBaseUrl).protocol === 'https:';
  const expectedOrigin = new URL(config.publicBaseUrl).origin;
  const sessions = new Map<string, Session>();
  const loginWindows = new Map<string, LoginWindow>();
  let writeQueue: Promise<void> = Promise.resolve();
  let pendingWrites = 0;

  function cleanup(): void {
    const now = Date.now();
    for (const [key, session] of sessions) if (session.expiresAt <= now) sessions.delete(key);
    for (const [key, window] of loginWindows) if (window.resetAt <= now) loginWindows.delete(key);
  }

  function sameOrigin(req: Request, res: Response, next: NextFunction): void {
    const origin = req.get('origin');
    if (origin && origin !== expectedOrigin) {
      res.status(403).json({ error: 'origin_not_allowed' });
      return;
    }
    next();
  }

  function requireSession(req: Request, res: Response, next: NextFunction): void {
    cleanup();
    const id = parseCookies(req).get(SESSION_COOKIE);
    const session = id ? sessions.get(id) : undefined;
    if (!id || !session || session.expiresAt <= Date.now()) {
      if (id) sessions.delete(id);
      res.status(401).json({ error: 'authentication_required' });
      return;
    }
    session.expiresAt = Date.now() + SESSION_TTL_MS;
    res.locals['configUiSession'] = session;
    res.locals['configUiSessionId'] = id;
    next();
  }

  function requireCsrf(req: Request, res: Response, next: NextFunction): void {
    const session = res.locals['configUiSession'] as Session | undefined;
    const csrf = req.get('x-csrf-token') ?? '';
    if (!session || !csrf || !secureEqual(csrf, session.csrf)) {
      res.status(403).json({ error: 'csrf_validation_failed' });
      return;
    }
    next();
  }

  function requireControlRate(req: Request, res: Response, next: NextFunction): void {
    const session = res.locals['configUiSession'] as Session | undefined;
    const now = Date.now();
    if (!session) {
      res.status(401).json({ error: 'authentication_required' });
      return;
    }
    if (session.controlResetAt <= now) {
      session.controlCount = 0;
      session.controlResetAt = now + CONTROL_WINDOW_MS;
    }
    session.controlCount += 1;
    if (session.controlCount > controlRateLimitMax) {
      res.status(429).json({ error: 'control_rate_limit_exceeded' });
      return;
    }
    next();
  }

  function enqueueWrite<T>(task: () => Promise<T>): Promise<T> {
    if (pendingWrites >= writeQueueMax) {
      return Promise.reject(Object.assign(new Error('Configuration write queue is full.'), { code: 'CONFIG_WRITE_QUEUE_FULL' }));
    }
    pendingWrites += 1;
    const result = writeQueue.then(task, task);
    writeQueue = result.then(() => undefined, () => undefined);
    return result.finally(() => { pendingWrites -= 1; });
  }

  router.use((_, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    next();
  });

  const configurePaths = ['/configure', `${addonBasePath(config)}/configure`];
  router.get(configurePaths, async (_req, res) => {
    const health = await statusService.getServiceHealth();
    res.type('html').send(configureHtml(config, health, authEnabled));
  });

  router.use('/api/config', express.json({ limit: JSON_LIMIT }));

  router.get('/api/config/bootstrap', (_req, res) => {
    res.json({
      authEnabled,
      version: config.version,
      manifestUrl: addonManifestUrl(config),
      stremioUrl: stremioInstallUrl(config)
    });
  });

  router.post('/api/config/session', sameOrigin, (req, res) => {
    cleanup();
    if (!authEnabled) {
      res.status(503).json({ error: 'configuration_token_not_enabled' });
      return;
    }
    const remote = req.ip ?? req.socket.remoteAddress ?? 'unknown';
    const now = Date.now();
    const window = loginWindows.get(remote);
    if (window && window.resetAt > now && window.count >= LOGIN_MAX_ATTEMPTS) {
      res.status(429).json({ error: 'too_many_attempts' });
      return;
    }
    const token = typeof req.body?.token === 'string' ? req.body.token : '';
    if (!secureEqual(token, adminToken)) {
      loginWindows.set(remote, {
        count: (window?.resetAt ?? 0) > now ? (window?.count ?? 0) + 1 : 1,
        resetAt: (window?.resetAt ?? 0) > now ? window!.resetAt : now + LOGIN_WINDOW_MS
      });
      logger.warn('Configuration UI login rejected', { remote });
      res.status(401).json({ error: 'invalid_token' });
      return;
    }
    loginWindows.delete(remote);
    const id = randomBytes(32).toString('base64url');
    const session: Session = {
      csrf: randomBytes(24).toString('base64url'),
      expiresAt: now + SESSION_TTL_MS,
      controlCount: 0,
      controlResetAt: now + CONTROL_WINDOW_MS
    };
    sessions.set(id, session);
    res.cookie(SESSION_COOKIE, id, {
      httpOnly: true,
      secure: secureCookie,
      sameSite: 'strict',
      path: '/',
      maxAge: SESSION_TTL_MS
    });
    logger.info('Configuration UI session created', { remote });
    res.json({ ok: true, csrf: session.csrf });
  });

  router.delete('/api/config/session', sameOrigin, requireSession, requireCsrf, (_req, res) => {
    const id = res.locals['configUiSessionId'] as string;
    sessions.delete(id);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.status(204).end();
  });

  router.get('/api/config', requireSession, async (_req, res) => {
    const { values } = await readEnvFile(envFile);
    const session = res.locals['configUiSession'] as Session;
    res.json({ csrf: session.csrf, config: buildViewModel(config, values) });
  });

  router.put('/api/config', sameOrigin, requireSession, requireCsrf, requireControlRate, async (req, res) => {
    try {
      const result = await enqueueWrite(async () => {
        const current = await readEnvFile(envFile);
        const updates = payloadToUpdates(req.body, config, current.values);
        const nextRaw = updateEnvContent(current.raw, updates);
        await atomicWriteEnv(envFile, nextRaw);
        return updates.size;
      });
      logger.info('Configuration UI saved managed settings', { envFile, managedKeyCount: result });
      res.json({
        ok: true,
        restartRequired: true,
        restartCommand: config.configUiRestartCommand,
        backupFile: `${envFile}.bak`
      });
    } catch (error) {
      logger.warn('Configuration UI save rejected', { error: error instanceof Error ? error.message : String(error) });
      const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
      res.status(code === 'CONFIG_WRITE_QUEUE_FULL' ? 429 : 400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.post('/api/config/test/:service', sameOrigin, requireSession, requireCsrf, requireControlRate, async (req, res) => {
    const service = req.params.service;
    try {
      const { values } = await readEnvFile(envFile);
      if (service === 'radarr' || service === 'sonarr') {
        const probe = arrProbeInput(req.body, service, config, values);
        const status = await fetchJson(`${probe.baseUrl}/api/v3/system/status`, {
          headers: { 'x-api-key': probe.apiKey, accept: 'application/json' }
        }, config.requestTimeoutMs) as Record<string, unknown>;
        res.json({
          ok: true,
          service,
          name: typeof status['appName'] === 'string' ? status['appName'] : service,
          version: typeof status['version'] === 'string' ? status['version'] : undefined
        });
        return;
      }
      if (service === 'tmdb') {
        const record = readRecord(req.body, 'TMDB probe');
        const storedBaseUrl = values.get('TMDB_API_BASE_URL') || config.tmdb.apiBaseUrl;
        const baseUrl = normalizeHttpUrl(record['baseUrl'] ?? storedBaseUrl, 'TMDB API URL');
        const suppliedToken = readStringField(record, 'authToken');
        const storedToken = values.get('TMDB_API_READ_ACCESS_TOKEN') || config.tmdb.authToken;
        const token = credentialForProbeOrigin(baseUrl, suppliedToken, storedBaseUrl, storedToken);
        if (!token) throw new Error('TMDB token must be supplied when testing a different server origin.');
        await fetchJson(`${baseUrl}/3/configuration`, {
          headers: { authorization: `Bearer ${token}`, accept: 'application/json' }
        }, config.requestTimeoutMs);
        res.json({ ok: true, service: 'tmdb' });
        return;
      }
      res.status(404).json({ error: 'unsupported_service' });
    } catch (error) {
      res.status(502).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.post('/api/config/options/:service', sameOrigin, requireSession, requireCsrf, requireControlRate, async (req, res) => {
    const service = req.params.service;
    if (service !== 'radarr' && service !== 'sonarr') {
      res.status(404).json({ error: 'unsupported_service' });
      return;
    }
    try {
      const { values } = await readEnvFile(envFile);
      const probe = arrProbeInput(req.body, service, config, values);
      const headers = { 'x-api-key': probe.apiKey, accept: 'application/json' };
      const get = (endpoint: string) => fetchJson(`${probe.baseUrl}${endpoint}`, { headers }, config.requestTimeoutMs);
      const [rootFoldersRaw, qualityProfilesRaw, tagsRaw, languageProfilesRaw] = await Promise.all([
        get('/api/v3/rootfolder'),
        get('/api/v3/qualityprofile'),
        get('/api/v3/tag').catch(() => []),
        service === 'sonarr' ? get('/api/v3/languageprofile').catch(() => []) : Promise.resolve([])
      ]);
      const mapOptions = (items: unknown, labelKeys: string[]) => asObjectArray(items).map((item) => ({
        id: typeof item['id'] === 'number' ? item['id'] : Number(item['id']),
        name: labelKeys.map((key) => item[key]).find((value) => typeof value === 'string') ?? String(item['id'] ?? '')
      })).filter((item) => Number.isInteger(item.id));
      res.json({
        ok: true,
        rootFolders: asObjectArray(rootFoldersRaw).map((item) => ({
          id: typeof item['id'] === 'number' ? item['id'] : Number(item['id']),
          path: typeof item['path'] === 'string' ? item['path'] : ''
        })).filter((item) => item.path),
        qualityProfiles: mapOptions(qualityProfilesRaw, ['name']),
        tags: mapOptions(tagsRaw, ['label', 'name']),
        languageProfiles: mapOptions(languageProfilesRaw, ['name'])
      });
    } catch (error) {
      res.status(502).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  return router;
}
