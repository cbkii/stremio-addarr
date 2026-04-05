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

export function renderActionConfirmPage(parsed: ParsedStremioId, actionPath: string): string {
  const kind = parsed.kind === 'movie' ? 'movie' : 'series';
  const title = parsed.kind === 'movie' ? 'Add to Radarr?' : 'Add to Sonarr?';
  const backUrl = escapeHtml(
    `stremio:///detail/${kind}/${parsed.imdbId}/${parsed.videoId ?? parsed.imdbId}`
  );
  return minimalHtml(
    title,
    `<p>${escapeHtml(parsed.rawId)}</p>` +
      `<form method="post" action="${escapeHtml(actionPath)}">` +
      `<button type="submit">Add + Search</button> ` +
      `<a href="${backUrl}">Cancel</a></form>`
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

