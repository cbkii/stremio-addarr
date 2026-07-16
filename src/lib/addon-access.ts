import type { AppConfig } from '../config.js';

export function addonBasePath(config: Pick<AppConfig, 'addonAccessToken'>): string {
  return `/${encodeURIComponent(config.addonAccessToken)}`;
}

export function addonBaseUrl(config: Pick<AppConfig, 'publicBaseUrl' | 'addonAccessToken'>): string {
  return `${config.publicBaseUrl.replace(/\/+$/, '')}${addonBasePath(config)}`;
}

export function addonManifestUrl(config: Pick<AppConfig, 'publicBaseUrl' | 'addonAccessToken'>): string {
  return `${addonBaseUrl(config)}/manifest.json`;
}

export function stremioInstallUrl(config: Pick<AppConfig, 'publicBaseUrl' | 'addonAccessToken'>): string {
  const manifest = new URL(addonManifestUrl(config));
  return `stremio://${manifest.host}${manifest.pathname}${manifest.search}`;
}
