# Roadmap

This file records intentionally deferred engineering work that has been reviewed but is not yet approved for implementation. Items should be revalidated against current code and operational evidence before being promoted into a PR.

## Reliability and maintainability decisions

### `/trakt/sync` defence-in-depth

**Status:** future implementation decision.

The local sync endpoint already rejects non-loopback client IPs under the supported loopback/Caddy trust-proxy model. Revisit whether it should additionally require an operator secret to reduce risk from local-process abuse or loopback SSRF while preserving the documented local `curl` recovery workflow.

Before implementation:

- test direct loopback access;
- test a real client IP forwarded by trusted loopback Caddy is rejected;
- test spoofed forwarding cannot bypass the boundary;
- define a beginner-friendly authentication mechanism that does not expose Trakt credentials.

### Trakt authentication edge-case coverage

**Status:** future implementation decision.

Consider adding focused tests for:

- `AbortError` / request timeout mapping to `trakt_request_timeout`;
- fallback token timing when provider `expires_in` metadata is absent or invalid.

Existing retry, rate-limit, device-flow, refresh and persisted-state tests should remain the baseline.

### Small pure-helper coverage

**Status:** future implementation decision.

Reassess low-risk focused tests for:

- `normalizeImdbId` malformed/whitespace/case inputs;
- `stremioInstallUrl` protected manifest URL conversion;
- malformed action-token rejection behaviour without relying on an implementation-specific `Buffer.from(..., 'base64url')` exception;
- logger invalid-URL credential-redaction fallback.

These are useful coverage improvements but lower priority than asynchronous queue, HTTP transport, cache-concurrency and external API fail-soft boundaries.

### Maintainability refactors

**Status:** defer until functional work touches the same areas.

Potential extraction targets:

- `buildViewModel` in `src/config-ui-core.ts`;
- `createAddonInterface` in `src/addon.ts`;
- `createApp` in `src/index.ts`.

Do not refactor solely to reduce line count. Any future extraction should preserve behaviour, reduce cognitive load measurably, avoid unnecessary abstraction, and be covered by the existing route/config/add-on regression suites.
