export const IMDB_ID_PATTERN = /^tt\d+$/i;

export function normalizeImdbId(value?: string): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed || !IMDB_ID_PATTERN.test(trimmed)) return undefined;
  return `tt${trimmed.slice(2)}`;
}
