declare module 'stremio-addon-sdk' {
  interface ManifestOptions {
    id: string;
    version: string;
    name: string;
    description?: string;
    resources: string[];
    types: string[];
    idPrefixes?: string[];
    catalogs?: unknown[];
    behaviorHints?: Record<string, unknown>;
  }

  interface StreamHandlerArgs {
    type: string;
    id: string;
  }

  interface StreamObject {
    name?: string;
    description?: string;
    externalUrl?: string;
    url?: string;
    title?: string;
    [key: string]: unknown;
  }

  interface StreamHandlerResult {
    streams: StreamObject[];
  }

  class addonBuilder {
    constructor(manifest: ManifestOptions);
    defineStreamHandler(
      handler: (args: StreamHandlerArgs) => Promise<StreamHandlerResult>
    ): void;
    getInterface(): AddonInterface;
  }

  interface AddonInterface {
    manifest: ManifestOptions;
  }

  function getRouter(addonInterface: AddonInterface): import('express').Router;
  function serveHTTP(addonInterface: AddonInterface, options?: { port?: number }): void;
}
