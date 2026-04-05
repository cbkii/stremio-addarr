import type { ParsedStremioId } from '../types.js';

const IMDB_RE = /^tt\d+$/;

export function parseStremioId(type: 'movie' | 'series', id: string): ParsedStremioId {
  const cleanedId = id.trim();

  if (type === 'movie') {
    if (!IMDB_RE.test(cleanedId)) {
      throw new Error(`Unsupported movie id: ${id}`);
    }
    // Reconstruct from validated imdbId to break taint from raw user input
    return {
      rawId: cleanedId,
      imdbId: cleanedId,
      kind: 'movie',
      videoId: cleanedId
    };
  }

  const parts = cleanedId.split(':');
  if (parts.length === 1) {
    if (!IMDB_RE.test(cleanedId)) {
      throw new Error(`Unsupported series id: ${id}`);
    }
    return {
      rawId: cleanedId,
      imdbId: cleanedId,
      kind: 'series',
      videoId: cleanedId
    };
  }

  const [imdbId, seasonRaw, episodeRaw] = parts;
  if (!IMDB_RE.test(imdbId)) {
    throw new Error(`Unsupported series imdb id: ${imdbId}`);
  }
  const season = Number(seasonRaw);
  const episode = Number(episodeRaw);
  if (!Number.isInteger(season) || !Number.isInteger(episode) || season <= 0 || episode <= 0) {
    throw new Error(`Unsupported series episode id: ${id}`);
  }

  // Reconstruct rawId and videoId from validated numeric components to break taint
  const safeRawId = `${imdbId}:${season}:${episode}`;
  return {
    rawId: safeRawId,
    imdbId,
    kind: 'series',
    season,
    episode,
    videoId: safeRawId
  };
}

export function toStremioDetailLink(parsed: ParsedStremioId): string {
  if (parsed.kind === 'movie') {
    return `stremio:///detail/movie/${parsed.imdbId}/${parsed.imdbId}`;
  }

  const videoId = parsed.videoId ?? parsed.imdbId;
  return `stremio:///detail/series/${parsed.imdbId}/${videoId}`;
}
