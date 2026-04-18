import { createHash, timingSafeEqual } from 'crypto';

/**
 * OpenSSH-style SHA256 host key fingerprint (`ssh-keygen -lf -E sha256`).
 * Input `key` is the raw host key from ssh2's host verifier.
 */
export function sshHostKeySha256Fingerprint(key: Buffer): string {
  const b64 = createHash('sha256').update(key).digest('base64');
  const trimmed = b64.replace(/=+$/, '');
  return `SHA256:${trimmed}`;
}

function normalizeFingerprintForCompare(raw: string): string {
  const t = raw.trim().replace(/\s+/g, '');
  if (!t) return '';
  const withPrefix = /^SHA256:/i.test(t) ? t : `SHA256:${t}`;
  return withPrefix.toUpperCase();
}

/** Constant-time comparison of two OpenSSH SHA256 host key fingerprints. */
export function sshHostKeysEqual(expected: string, observed: string): boolean {
  const a = normalizeFingerprintForCompare(expected);
  const b = normalizeFingerprintForCompare(observed);
  if (!a || !b || a.length !== b.length) {
    return false;
  }
  try {
    return timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
  } catch {
    return false;
  }
}
