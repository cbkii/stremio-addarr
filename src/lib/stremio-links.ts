import type { ParsedStremioId } from '../types.js';

/**
 * Return to the current Stremio detail/video view without requesting autoplay.
 * Parsed Stremio IDs are already restricted to the IMDb/Cinemeta-style format
 * accepted by this add-on, so preserving ':' in the video ID matches Stremio's
 * documented Android TV deep-link examples.
 */
export function buildStremioDetailDeepLink(parsed: ParsedStremioId): string {
  return `stremio:///detail/${parsed.kind}/${parsed.imdbId}/${parsed.rawId}?autoPlay=false`;
}
