import type { AddActionResult, ParsedStremioId } from '../types.js';

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function minimalHtml(title: string, body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head><body>${body}</body></html>`;
}

/**
 * Renders a minimal confirm/action form.
 * When autoSubmit=true (ACTION_CONFIRM=false), a script auto-submits the POST
 * immediately so the user never has to click — while keeping the GET safe.
 * When autoSubmit=false (ACTION_CONFIRM=true), shows an explicit confirm button.
 */
export function renderActionConfirmPage(
  parsed: ParsedStremioId,
  actionPath: string,
  autoSubmit: boolean
): string {
  const kind = parsed.kind === 'movie' ? 'movie' : 'series';
  const title = parsed.kind === 'movie' ? 'Add to Radarr?' : 'Add to Sonarr?';
  const backUrl = escapeHtml(
    `stremio:///detail/${kind}/${parsed.imdbId}/${parsed.videoId ?? parsed.imdbId}`
  );
  const autoScript = autoSubmit
    ? '<script>window.addEventListener("DOMContentLoaded",function(){document.forms[0]&&document.forms[0].submit();});</script>'
    : '';
  const submitLabel = autoSubmit ? 'Adding…' : 'Add + Search';
  return minimalHtml(
    title,
    `<form method="post" action="${escapeHtml(actionPath)}">` +
      `<button type="submit">${submitLabel}</button> ` +
      `<a href="${backUrl}">Cancel</a></form>` +
      autoScript
  );
}

export function renderActionResultPage(result: AddActionResult, returnUrl: string): string {
  const prefix = result.ok ? '' : 'Failed: ';
  const detail = result.detail ? ` — ${result.detail}` : '';
  return minimalHtml(
    `${prefix}${result.title}`,
    `<p>${escapeHtml(result.summary)}${escapeHtml(detail)}</p>` +
      `<p><a href="${escapeHtml(returnUrl)}">&#8592; Back to Stremio</a></p>`
  );
}

export function renderActionErrorPage(message: string, returnUrl: string): string {
  return minimalHtml(
    'Action Error',
    `<p>${escapeHtml(message)}</p>` +
      `<p><a href="${escapeHtml(returnUrl)}">&#8592; Back to Stremio</a></p>`
  );
}

