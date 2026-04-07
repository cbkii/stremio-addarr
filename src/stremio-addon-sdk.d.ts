declare module 'stremio-addon-sdk' {
  export interface Manifest {
    id: string;
    version: string;
    name: string;
    description: string;
    catalogs: unknown[];
    resources: Array<'catalog' | 'meta' | 'stream' | 'subtitles' | string>;
    types: string[];
    idPrefixes?: string[];
    behaviorHints?: {
      configurable?: boolean;
      configurationRequired?: boolean;
    };
    config?: unknown[];
  }

  export interface Stream {
    name: string;
    description?: string;
    url?: string;
    externalUrl?: string;
    externalUris?: Array<{ uri: string; name?: string }>;
    behaviorHints?: { notWebReady?: boolean };
  }

  export interface StreamHandlerArgs {
    type: string;
    id: string;
    extra?: Record<string, string>;
  }

  export interface CatalogHandlerArgs {
    type: string;
    id: string;
    extra?: Record<string, string>;
  }

  export interface MetaPreview {
    id: string;
    type: string;
    name: string;
    poster?: string;
    posterShape?: 'poster' | 'landscape' | 'square';
    releaseInfo?: string;
    description?: string;
  }

  export class addonBuilder {
    constructor(manifest: Manifest);
    defineStreamHandler(handler: (args: StreamHandlerArgs) => Promise<{ streams: Stream[]; cacheMaxAge?: number; staleRevalidate?: number }> | { streams: Stream[]; cacheMaxAge?: number; staleRevalidate?: number }): void;
    defineCatalogHandler(handler: (args: CatalogHandlerArgs) => Promise<{ metas: MetaPreview[]; cacheMaxAge?: number; staleRevalidate?: number; staleError?: number }> | { metas: MetaPreview[]; cacheMaxAge?: number; staleRevalidate?: number; staleError?: number }): void;
    getInterface(): unknown;
  }

  export function getRouter(addonInterface: unknown): import('express').RequestHandler;

  const sdk: {
    getRouter: typeof getRouter;
  };
  export default sdk;
}
