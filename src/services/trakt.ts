import { TtlCache } from '../lib/cache.js';

const TRAKT_BASE_URL = 'https://trakt.tv';
const DEFAULT_TIMEOUT_MS = 4_000;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

export interface TraktLookup {
  getMovieReleaseDate(imdbId: string): Promise<string | undefined>;
  getEpisodeReleaseDate(imdbId: string, season?: number, episode?: number): Promise<string | undefined>;
}

export class TraktHtmlLookup implements TraktLookup {
  private readonly cache = new TtlCache<string | undefined>(CACHE_TTL_MS);

  async getMovieReleaseDate(imdbId: string): Promise<string | undefined> {
    const key = `movie:${imdbId}`;
    const cached = this.cache.get(key);
    if (cached !== undefined) {
      return cached;
    }
    const path = await this.findEntityPath(imdbId, 'movies');
    if (!path) {
      this.cache.set(key, undefined);
      return undefined;
    }
    const html = await this.fetchText(`${TRAKT_BASE_URL}${path}`);
    const date = this.extractDate(html);
    this.cache.set(key, date);
    return date;
  }

  async getEpisodeReleaseDate(imdbId: string, season?: number, episode?: number): Promise<string | undefined> {
    const key = `episode:${imdbId}:${season ?? ''}:${episode ?? ''}`;
    const cached = this.cache.get(key);
    if (cached !== undefined) {
      return cached;
    }
    if (season == null || episode == null) {
      this.cache.set(key, undefined);
      return undefined;
    }
    const showPath = await this.findEntityPath(imdbId, 'shows');
    if (!showPath) {
      this.cache.set(key, undefined);
      return undefined;
    }
    const episodeUrl = `${TRAKT_BASE_URL}${showPath}/seasons/${season}/episodes/${episode}`;
    const html = await this.fetchText(episodeUrl);
    const date = this.extractDate(html);
    this.cache.set(key, date);
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
