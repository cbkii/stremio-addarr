import type { AppConfig } from '../src/config.js';

export function baseConfig(): AppConfig {
  return {
    appName: 'stremio-addarr',
    version: '0.1.0-test',
    host: '127.0.0.1',
    port: 0,
    publicBaseUrl: 'http://127.0.0.1:7010',
    manifestLogoUrl: 'https://raw.githubusercontent.com/cbkii/stremio-addarr/main/assets/logo.png',
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
    catalogPageSize: 25,
    catalogCacheTtlMs: 5_000,
    catalogCacheMaxAgeSec: 15,
    catalogStaleRevalidateSec: 60,
    catalogStaleErrorSec: 120,
    fileStreaming: {
      enabled: false,
      secret: '',
      playbackMode: 'kodi'
    },
    kodi: {
      enabled: true,
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
      searchOnAdd: true
    },
    sonarr: {
      enabled: false,
      baseUrl: 'http://sonarr.local',
      cardUrl: '192.168.1.50:8989',
      apiKey: 'sonarr-key',
      rootFolderPath: '/tv',
      qualityProfileId: 1,
      languageProfileId: 1,
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
      redirectUri: 'urn:ietf:wg:oauth:2.0:oob',
      stateFilePath: '/tmp/stremio-addarr-test-trakt-sync.json'
    }
  };
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
