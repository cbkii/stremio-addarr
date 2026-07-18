import type { AppConfig } from '../src/config.js';
import { buildDefaultManifestLogoUrl } from '../src/config.js';
import { addonBasePath } from '../src/lib/addon-access.js';
import { buildActionToken } from '../src/lib/action-tokens.js';
import { buildFileToken } from '../src/lib/file-tokens.js';

export function baseConfig(): AppConfig {
  return {
    appName: 'stremio-addarr',
    version: '0.1.0-test',
    host: '127.0.0.1',
    port: 0,
    publicBaseUrl: 'http://127.0.0.1:7010',
    addonAccessToken: 'test-addon-access-token-0123456789abcdef',
    actionTokenTtlSec: 300,
    actionRateLimitMax: 20,
    actionQueueMax: 100,
    configUiEnabled: false,
    configUiRestartCommand: 'sudo systemctl restart stremio-addarr',
    manifestLogoUrl: buildDefaultManifestLogoUrl('http://127.0.0.1:7010', '0.1.0-test'),
    targetClient: 'android-tv',
    timeZone: 'UTC',
    logLevel: 'error',
    requestTimeoutMs: 2000,
    gracefulShutdownTimeoutMs: 10_000,
    forcedShutdownExitCode: 0,
    statusCacheTtlMs: 10_000,
    serviceHealthCacheTtlMs: 2_000,
    streamCacheMaxAgeSec: 2,
    streamStaleRevalidateSec: 5,
    catalogPageSize: 100,
    radarrCatalogWatchedKeepCount: 1,
    catalogCacheTtlMs: 5_000,
    catalogCacheMaxAgeSec: 15,
    catalogStaleRevalidateSec: 60,
    catalogStaleErrorSec: 120,
    fileStreaming: {
      enabled: false,
      secret: '',
      tokenTtlSec: 3600,
      playbackMode: 'kodi'
    },
    kodi: {
      enabled: false,
      packageName: 'org.xbmc.kodi'
    },
    radarr: {
      enabled: false,
      baseUrl: 'http://radarr.local',
      cardUrl: '192.168.1.50:7878',
      apiKey: 'radarr-key',
      rootFolderPath: '/movies',
      qualityProfileId: 1,
      minimumAvailability: 'announced',
      tags: [],
      searchOnAdd: true,
      strictImdbMatch: false
    },
    sonarr: {
      enabled: false,
      baseUrl: 'http://sonarr.local',
      cardUrl: '192.168.1.50:8989',
      apiKey: 'sonarr-key',
      rootFolderPath: '/tv',
      qualityProfileId: 1,
      languageProfileId: null,
      seriesMonitor: 'all',
      monitorNewItems: 'auto',
      episodeReadyTimeoutMs: 60_000,
      episodeReadyPollMs: 1_500,
      epCount: 2,
      epCountPast: 8,
      epCountMod: 'epfuture',
      tags: [],
      searchOnAdd: true
    },
    traktSync: {
      enabled: false,
      syncMins: 360,
      apiBaseUrl: 'https://api.trakt.tv',
      clientId: '',
      clientSecret: '',
      refreshToken: '',
      accessToken: '',
      accessTokenCreatedAt: 0,
      accessTokenExpiresIn: 0,
      redirectUri: 'https://example.invalid/trakt/callback',
      authGeneration: '',
      stateFilePath: '/tmp/stremio-addarr-test-trakt-sync.json'
    },
    tmdb: {
      apiBaseUrl: 'https://api.themoviedb.org',
      authToken: '',
      region: 'US'
    }
  };
}

export function addonUrl(baseUrl: string, config: AppConfig = baseConfig()): string {
  return `${baseUrl}${addonBasePath(config)}`;
}

export function signedActionUrl(
  baseUrl: string,
  config: AppConfig,
  action: 'search' | 'add-search',
  kind: 'movie' | 'series',
  rawId: string,
  expiresAtSec = Math.floor(Date.now() / 1000) + config.actionTokenTtlSec
): string {
  const signature = buildActionToken(config.addonAccessToken, action, kind, rawId, expiresAtSec);
  return `${addonUrl(baseUrl, config)}/action/${action}/${kind}/${encodeURIComponent(rawId)}?exp=${expiresAtSec}&sig=${encodeURIComponent(signature)}`;
}

export function signedFileUrl(
  baseUrl: string,
  config: AppConfig,
  kind: 'movie' | 'series',
  fileId: number,
  options: { secret?: string; tokenFileId?: number; token?: string; expiresAtSec?: number } = {}
): string {
  const expiresAtSec = options.expiresAtSec ?? Math.floor(Date.now() / 1000) + config.fileStreaming.tokenTtlSec;
  const token = options.token ?? buildFileToken(
    options.secret ?? config.fileStreaming.secret,
    kind,
    options.tokenFileId ?? fileId,
    expiresAtSec
  );
  return `${addonUrl(baseUrl, config)}/files/${kind}/${fileId}?exp=${expiresAtSec}&t=${encodeURIComponent(token)}`;
}

export async function withServer<T>(
  app: import('express').Express,
  run: (baseUrl: string) => Promise<T>
): Promise<T> {
  const server = await new Promise<import('http').Server>((resolve) => {
    const started = app.listen(0, '127.0.0.1', () => resolve(started));
  });

  try {
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Could not determine server address.');
    }
    return await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}
