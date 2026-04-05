import type { AppConfig } from '../config.js';
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
      .actions a, .actions button { display: inline-block; margin-right: 12px; margin-top: 8px; }
      button { background: #0f172a; border: 1px solid #334155; border-radius: 8px; padding: 10px 16px; cursor: pointer; }
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

  return shell(
    'stremio-addarr',
    `
    <h1>Arr Status &amp; Add</h1>
    <p>Self-hosted LAN-first Stremio add-on for Radarr and Sonarr status + add actions.</p>

    <section class="card">
      <h2>Install</h2>
      <p>Manifest URL:</p>
      <pre>${escapeHtml(manifestUrl)}</pre>
      <p>Stremio install URL:</p>
      <pre>${escapeHtml(installUrl)}</pre>
      <p>Tip: use HTTPS when Stremio runs on a different device.</p>
    </section>

    <section class="card">
      <h2>Health</h2>
      <ul>
        <li>Version: <code>${escapeHtml(config.version)}</code></li>
        <li>Radarr: ${serviceState(health.radarr)}</li>
        <li>Sonarr: ${serviceState(health.sonarr)}</li>
        <li>Confirm before action: ${config.actionConfirm ? '<span class="warn">on</span>' : '<span class="ok">off</span>'}</li>
      </ul>
      <p><a href="/health">Open /health JSON</a></p>
    </section>

    <section class="card">
      <h2>Checklist</h2>
      <ol>
        <li>Set Arr URLs and API keys in <code>.env</code>.</li>
        <li>Confirm both services are reachable above.</li>
        <li>Install from manifest URL in Stremio.</li>
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
        <button type="submit">Confirm Add + Search</button>
        <a href="${escapeHtml(`stremio:///detail/${kind}/${parsed.imdbId}/${parsed.videoId ?? parsed.imdbId}`)}">Back to Stremio</a>
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
        <a href="${escapeHtml(returnUrl)}">Back to Stremio</a>
        <a href="/">Add-on Home</a>
      </div>
    </section>
  `
  );
}
