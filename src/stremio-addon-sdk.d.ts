declare module 'stremio-addon-sdk' {
  export interface Manifest {
    id: string;
    version: string;
    name: string;
    description?: string;
    catalogs?: unknown[];
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
  }

  export interface StreamHandlerArgs {
    type: string;
    id: string;
    extra?: Record<string, string>;
  }

  export class addonBuilder {
    constructor(manifest: Manifest);
    defineStreamHandler(handler: (args: StreamHandlerArgs) => Promise<{ streams: Stream[]; cacheMaxAge?: number; staleRevalidate?: number }> | { streams: Stream[]; cacheMaxAge?: number; staleRevalidate?: number }): void;
    getInterface(): unknown;
  }

  export function getRouter(addonInterface: unknown): import('express').RequestHandler;

  const sdk: {
    getRouter: typeof getRouter;
  };
  export default sdk;
}
