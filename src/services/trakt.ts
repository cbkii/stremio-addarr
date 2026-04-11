import { TtlCache } from '../lib/cache.js';

const TRAKT_API_BASE_URL = 'https://api.trakt.tv';
const TRAKT_BASE_URL = 'https://trakt.tv';
const DEFAULT_TIMEOUT_MS = 4_000;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

export interface TraktLookup {
  getMovieReleaseDate(imdbId: string): Promise<string | undefined>;
  getEpisodeReleaseDate(imdbId: string, season?: number, episode?: number): Promise<string | undefined>;
}

// Wrapping the cached value distinguishes "cached not-found" ({ value: undefined })
// from a genuine cache miss (entry absent), fixing silent 6-hour TTL bypass.
type CachedDate = { value: string | undefined };

interface TraktSearchResult {
  type?: string;
  movie?: { released?: string };
  show?: { ids?: { slug?: string } };
}

/**
 * Release-date lookup via the official Trakt JSON API (api.trakt.tv).
 * Requires a Trakt Client-ID (public data — no OAuth bearer needed).
 * Single HTTP request for movies; two sequential requests for episodes.
 */
export class TraktApiLookup implements TraktLookup {
  private readonly cache = new TtlCache<CachedDate>(CACHE_TTL_MS);

  constructor(private readonly clientId: string) {}

  async getMovieReleaseDate(imdbId: string): Promise<string | undefined> {
    const key = `movie:${imdbId}`;
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached.value;

    const results = await this.apiGet<TraktSearchResult[]>(`/search/imdb/${encodeURIComponent(imdbId)}?type=movie`);
    const date = (results ?? []).find((r) => r.type === 'movie')?.movie?.released ?? undefined;
    this.cache.set(key, { value: date });
    return date;
  }

  async getEpisodeReleaseDate(imdbId: string, season?: number, episode?: number): Promise<string | undefined> {
    const key = `episode:${imdbId}:${season ?? ''}:${episode ?? ''}`;
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached.value;

    if (season == null || episode == null) {
      this.cache.set(key, { value: undefined });
      return undefined;
    }

    const showResults = await this.apiGet<TraktSearchResult[]>(`/search/imdb/${encodeURIComponent(imdbId)}?type=show`);
    const slug = (showResults ?? []).find((r) => r.type === 'show')?.show?.ids?.slug;
    if (!slug) {
      this.cache.set(key, { value: undefined });
      return undefined;
    }

    const ep = await this.apiGet<{ first_aired?: string }>(
      `/shows/${encodeURIComponent(slug)}/seasons/${season}/episodes/${episode}?extended=full`
    );
    // first_aired is a UTC ISO timestamp; slice to YYYY-MM-DD for TZ-neutral display.
    const date = ep?.first_aired ? ep.first_aired.slice(0, 10) : undefined;
    this.cache.set(key, { value: date });
    return date;
  }

  private async apiGet<T>(path: string): Promise<T | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
    try {
      const response = await fetch(`${TRAKT_API_BASE_URL}${path}`, {
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'trakt-api-key': this.clientId,
          'trakt-api-version': '2'
        }
      });
      if (!response.ok) return null;
      return await response.json() as T;
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }
}

/**
 * Fallback release-date lookup via Trakt HTML scraping (no credentials needed).
 * Used when no Trakt Client-ID is configured.  Prefer TraktApiLookup when available.
 */
export class TraktHtmlLookup implements TraktLookup {
  private readonly cache = new TtlCache<CachedDate>(CACHE_TTL_MS);

  async getMovieReleaseDate(imdbId: string): Promise<string | undefined> {
    const key = `movie:${imdbId}`;
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached.value;

    const path = await this.findEntityPath(imdbId, 'movies');
    if (!path) {
      this.cache.set(key, { value: undefined });
      return undefined;
    }
    const html = await this.fetchText(`${TRAKT_BASE_URL}${path}`);
    const date = this.extractDate(html);
    this.cache.set(key, { value: date });
    return date;
  }

  async getEpisodeReleaseDate(imdbId: string, season?: number, episode?: number): Promise<string | undefined> {
    const key = `episode:${imdbId}:${season ?? ''}:${episode ?? ''}`;
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached.value;

    if (season == null || episode == null) {
      this.cache.set(key, { value: undefined });
      return undefined;
    }
    const showPath = await this.findEntityPath(imdbId, 'shows');
    if (!showPath) {
      this.cache.set(key, { value: undefined });
      return undefined;
    }
    const episodeUrl = `${TRAKT_BASE_URL}${showPath}/seasons/${season}/episodes/${episode}`;
    const html = await this.fetchText(episodeUrl);
    const date = this.extractDate(html);
    this.cache.set(key, { value: date });
    return date;
  }

  private async findEntityPath(imdbId: string, entityKind: 'movies' | 'shows'): Promise<string | undefined> {
    const html = await this.fetchText(`${TRAKT_BASE_URL}/search/imdb/${encodeURIComponent(imdbId)}`);
    const re = new RegExp(`href=\"\\/(?:${entityKind})\\/[^\"#?]+`, 'i');
    const match = html.match(re);
    if (!match?.[0]) return undefined;
    return match[0].replace(/^href="/, '');
  }

  private extractDate(html: string): string | undefined {
    const jsonLd = html.match(/"datePublished"\s*:\s*"(\d{4}-\d{2}-\d{2})"/i)?.[1];
    if (jsonLd) return jsonLd;
    const datetime = html.match(/datetime="(\d{4}-\d{2}-\d{2})(?:T[^"]*)?"/i)?.[1];
    if (datetime) return datetime;
    return undefined;
  }

  private async fetchText(url: string): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
        headers: {
          'User-Agent': 'stremio-addarr/1.0 (+https://github.com/cbkii/stremio-addarr)'
        }
      });
      if (!response.ok) return '';
      return await response.text();
    } catch {
      return '';
    } finally {
      clearTimeout(timeout);
    }
  }
}
