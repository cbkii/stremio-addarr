import type { AppConfig } from '../src/config.js';

export function baseConfig(): AppConfig {
  return {
    appName: 'stremio-addarr',
    version: '0.1.0-test',
    host: '127.0.0.1',
    port: 0,
    publicBaseUrl: 'http://127.0.0.1:7010',
    targetClient: 'android-tv',
    logLevel: 'error',
    requestTimeoutMs: 2000,
    statusCacheTtlMs: 10_000,
    serviceHealthCacheTtlMs: 2_000,
    streamCacheMaxAgeSec: 2,
    streamStaleRevalidateSec: 5,
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
      apiKey: 'sonarr-key',
      rootFolderPath: '/tv',
      qualityProfileId: 1,
      languageProfileId: 1,
      seriesMonitor: 'all',
      tags: [],
      searchOnAdd: true
    },
    tmdbApiKey: undefined
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
