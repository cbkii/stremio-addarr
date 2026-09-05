export function isWebReadyHttpsMp4(url: string | undefined, filename: string | undefined): boolean {
  if (!url || !filename) return false;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  if (parsed.protocol !== 'https:') return false;

  const cleanFilename = filename.trim().split(/[?#]/, 1)[0];
  return /\.mp4$/i.test(cleanFilename);
}
