import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Build an HMAC-SHA256 token for a given file kind and ID.
 * Token is a hex-encoded 32-byte digest.
 */
export function buildFileToken(secret: string, kind: string, fileId: number): string {
  return createHmac('sha256', secret)
    .update(`${kind}:${fileId}`)
    .digest('hex');
}

/**
 * Verify a file token in constant time.
 * Returns false for any input that doesn't match, including wrong-length tokens.
 */
export function verifyFileToken(secret: string, kind: string, fileId: number, token: string): boolean {
  const expected = buildFileToken(secret, kind, fileId);
  if (token.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(token, 'utf8'), Buffer.from(expected, 'utf8'));
  } catch {
    return false;
  }
}
