import type { AppConfig } from '../config.js';
import { validateConfig } from '../config.js';
import type { AddActionResult, ParsedStremioId, ServiceHealth } from '../types.js';

function shell(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style>
      :root { color-scheme: dark; }
      body { font-family: system-ui, sans-serif; margin: 0; background: #111827; color: #f9fafb; }
      main { max-width: 720px; margin: 0 auto; padding: 24px; }
      .card { background: #1f2937; border-radius: 16px; padding: 20px; margin: 16px 0; }
      code, pre { background: #0f172a; border-radius: 8px; padding: 2px 6px; }
      a, button { color: #93c5fd; font: inherit; }
      h1, h2 { margin-top: 0; }
      .ok { color: #86efac; }
      .warn { color: #fcd34d; }
      .bad { color: #fca5a5; }
      .actions { margin-top: 16px; }
      .actions a, .actions button {
        display: inline-block; margin-right: 16px; margin-top: 12px;
        font-size: 1.1rem; padding: 14px 22px;
        background: #0f172a; border: 1px solid #334155; border-radius: 10px;
        cursor: pointer; text-decoration: none;
      }
      .actions a:focus, .actions button:focus { outline: 3px solid #93c5fd; }
      .btn-primary { background: #1e3a5f !important; border-color: #3b82f6 !important; font-weight: bold; }
    </style>
  </head>
  <body>
    <main>${body}</main>
  </body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function serviceState(service: ServiceHealth): string {
  if (!service.configured) return '<span class="warn">disabled</span>';
  return service.reachable ? '<span class="ok">reachable</span>' : '<span class="bad">unreachable</span>';
}

export function renderLandingPage(
  config: AppConfig,
  health: { radarr: ServiceHealth; sonarr: ServiceHealth }
): string {
  const manifestUrl = `${config.publicBaseUrl}/manifest.json`;
  const installUrl = manifestUrl.replace(/^https?:\/\//, 'stremio://');
  const validation = validateConfig(config);
  const httpsLabel = validation.isHttps
    ? '<span class="ok">✓ HTTPS</span>'
    : '<span class="warn">⚠ HTTP only</span>';
  const httpsNote = validation.isHttps
    ? ''
    : '<p class="warn">⚠ Not HTTPS — Stremio on Android TV may require HTTPS. Use Caddy reverse proxy.</p>';

  return shell(
    'stremio-addarr',
    `
    <h1>Arr Status &amp; Add</h1>
    <p>Self-hosted LAN-first Stremio add-on for Radarr and Sonarr status + add actions.</p>

    <section class="card">
      <h2>Install</h2>
      <p>Public URL: ${httpsLabel}</p>
      ${httpsNote}
      <p>Manifest URL:</p>
      <pre>${escapeHtml(manifestUrl)}</pre>
      <p>Stremio install URL:</p>
      <pre>${escapeHtml(installUrl)}</pre>
    </section>

    <section class="card">
      <h2>Health</h2>
      <ul>
        <li>Version: <code>${escapeHtml(config.version)}</code></li>
        <li>Radarr: ${serviceState(health.radarr)}</li>
        <li>Sonarr: ${serviceState(health.sonarr)}</li>
        <li>Confirm before action: ${config.actionConfirm ? '<span class="warn">on</span>' : '<span class="ok">off</span>'}</li>
      </ul>
      <p>
        <a href="/healthz">/healthz</a> &nbsp;|&nbsp;
        <a href="/health">/health</a> &nbsp;|&nbsp;
        <a href="/status.json">/status.json</a>
      </p>
    </section>

    <section class="card">
      <h2>Pi / LAN Setup</h2>
      <ol>
        <li>Set Arr URLs and API keys in <code>.env</code> (Radarr/Sonarr on same Pi or LAN IP).</li>
        <li>For Android TV: set up Caddy for HTTPS (<code>PUBLIC_BASE_URL=https://stremio-addarr.lan</code>).</li>
        <li>Confirm both services are reachable above.</li>
        <li>Install from the manifest URL in Stremio.</li>
      </ol>
    </section>
  `
  );
}

export function renderActionConfirmPage(parsed: ParsedStremioId, actionPath: string): string {
  const kind = parsed.kind === 'movie' ? 'movie' : 'series';
  const title = parsed.kind === 'movie' ? 'Add movie to Radarr?' : 'Add series to Sonarr?';

  return shell(
    title,
    `
    <section class="card">
      <h1>${escapeHtml(title)}</h1>
      <p>Item: <code>${escapeHtml(parsed.rawId)}</code></p>
      <form method="post" action="${escapeHtml(actionPath)}" class="actions">
        <button type="submit" class="btn-primary">Confirm Add + Search</button>
        <a href="${escapeHtml(`stremio:///detail/${kind}/${parsed.imdbId}/${parsed.videoId ?? parsed.imdbId}`)}">← Back to Stremio</a>
      </form>
    </section>
  `
  );
}

export function renderActionResultPage(result: AddActionResult, returnUrl: string): string {
  const statusClass = result.ok ? 'ok' : 'bad';
  return shell(
    result.title,
    `
    <section class="card">
      <h1 class="${statusClass}">${escapeHtml(result.title)}</h1>
      <p>${escapeHtml(result.summary)}</p>
      ${result.detail ? `<p>${escapeHtml(result.detail)}</p>` : ''}
      <div class="actions">
        <a href="${escapeHtml(returnUrl)}" class="btn-primary">← Back to Stremio</a>
        <a href="/">Add-on Home</a>
      </div>
    </section>
  `
  );
}
