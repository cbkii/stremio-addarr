import { createHmac, timingSafeEqual } from 'node:crypto';

function digest(secret: string, kind: string, fileId: number, expiresAtSec: number): Buffer {
  return createHmac('sha256', secret).update(`${kind}:${fileId}:${expiresAtSec}`).digest();
}

/**
 * Build a signed file token. Runtime URLs always pass an expiry. The default
 * expiry keeps the legacy helper signature stable for downstream tests/tools;
 * the HTTP route never accepts that non-expiring form.
 */
export function buildFileToken(secret: string, kind: string, fileId: number, expiresAtSec = 0): string {
  return digest(secret, kind, fileId, expiresAtSec).toString('hex');
}

export function verifyFileToken(
  secret: string,
  kind: string,
  fileId: number,
  expiresAtSecOrToken: number | string,
  tokenMaybe?: string,
  nowSec = Math.floor(Date.now() / 1000)
): boolean {
  const legacyCall = typeof expiresAtSecOrToken === 'string';
  const expiresAtSec = legacyCall ? 0 : expiresAtSecOrToken;
  const token = legacyCall ? expiresAtSecOrToken : (tokenMaybe ?? '');
  if (!legacyCall && (!Number.isSafeInteger(expiresAtSec) || expiresAtSec < nowSec || expiresAtSec > nowSec + 86_400)) return false;
  if (!/^[0-9a-f]{64}$/i.test(token)) return false;
  const expected = digest(secret, kind, fileId, expiresAtSec);
  const actual = Buffer.from(token, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
