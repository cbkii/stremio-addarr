import { createHmac, timingSafeEqual } from 'node:crypto';

function digest(secret: string, action: string, kind: string, rawId: string, expiresAtSec: number): Buffer {
  return createHmac('sha256', secret)
    .update(`${action}:${kind}:${rawId}:${expiresAtSec}`)
    .digest();
}

export function buildActionToken(secret: string, action: string, kind: string, rawId: string, expiresAtSec: number): string {
  return digest(secret, action, kind, rawId, expiresAtSec).toString('base64url');
}

export function verifyActionToken(
  secret: string,
  action: string,
  kind: string,
  rawId: string,
  expiresAtSec: number,
  token: string,
  nowSec = Math.floor(Date.now() / 1000)
): boolean {
  if (!Number.isSafeInteger(expiresAtSec) || expiresAtSec < nowSec || expiresAtSec > nowSec + 86_400 || !token) return false;
  const expected = digest(secret, action, kind, rawId, expiresAtSec);
  let actual: Buffer;
  try { actual = Buffer.from(token, 'base64url'); } catch { return false; }
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
