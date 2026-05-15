import {
  createPrivateKey,
  createPublicKey,
  type KeyObject,
  sign,
  verify,
} from 'node:crypto';

/** Wire format version prefix (payload + Ed25519 signature). */
export const ENTERPRISE_LICENSE_TOKEN_PREFIX = 'whl1';

const MESSAGE_PREFIX = `${ENTERPRISE_LICENSE_TOKEN_PREFIX}.`;

export type EnterpriseLicenseTokenPayload = {
  v: 1;
  /** Optional expiry (Unix seconds). */
  exp?: number;
  /** Optional "not before" (Unix seconds). */
  nbf?: number;
  /** Optional customer / order label (for your records only). */
  sub?: string;
};

export function encodeEnterpriseLicensePayload(
  payload: EnterpriseLicenseTokenPayload,
): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

/**
 * Accepts either PEM (`-----BEGIN PUBLIC KEY-----`) or a single-line **base64(SPKI DER)**
 * (what some tools print instead of PEM). Must match the private key used to mint `whl1...` tokens.
 */
export function createEnterpriseLicensePublicKey(raw: string): KeyObject {
  const t = raw.trim();
  if (!t) {
    throw new Error('Enterprise license public key is empty');
  }
  if (t.includes('BEGIN')) {
    return createPublicKey({ key: t, format: 'pem' });
  }
  const der = Buffer.from(t.replace(/\s+/g, ''), 'base64');
  return createPublicKey({ key: der, format: 'der', type: 'spki' });
}

/** Build a single-line license string (give this to the customer). */
export function buildSignedEnterpriseLicenseToken(
  payload: EnterpriseLicenseTokenPayload,
  privateKeyPem: string,
): string {
  const priv = createPrivateKey({ key: privateKeyPem.trim(), format: 'pem' });
  const body = encodeEnterpriseLicensePayload(payload);
  const msg = Buffer.from(`${MESSAGE_PREFIX}${body}`, 'utf8');
  const sig = sign(null, msg, priv);
  const sigB64 = sig.toString('base64url');
  return `${ENTERPRISE_LICENSE_TOKEN_PREFIX}.${body}.${sigB64}`;
}

/**
 * Verify a license token. Returns payload when valid and within `exp` / `nbf`; otherwise null.
 */
export function verifySignedEnterpriseLicenseToken(
  token: string,
  publicKeyPem: string,
): EnterpriseLicenseTokenPayload | null {
  const t = token.trim();
  const parts = t.split('.');
  if (parts.length !== 3 || parts[0] !== ENTERPRISE_LICENSE_TOKEN_PREFIX) {
    return null;
  }
  const [, body, sigB64] = parts;
  if (!body || !sigB64) return null;
  try {
    const pub = createEnterpriseLicensePublicKey(publicKeyPem);
    const msg = Buffer.from(`${MESSAGE_PREFIX}${body}`, 'utf8');
    let sig: Buffer;
    try {
      sig = Buffer.from(sigB64, 'base64url');
    } catch {
      return null;
    }
    if (!verify(null, msg, pub, sig)) return null;
    const raw = Buffer.from(body, 'base64url').toString('utf8');
    const json = JSON.parse(raw) as unknown;
    if (!json || typeof json !== 'object') return null;
    const rec = json as { v?: unknown; exp?: unknown; nbf?: unknown; sub?: unknown };
    if (rec.v !== 1) return null;
    if (rec.exp !== undefined && typeof rec.exp !== 'number') return null;
    if (rec.nbf !== undefined && typeof rec.nbf !== 'number') return null;
    if (rec.sub !== undefined && typeof rec.sub !== 'string') return null;
    const now = Math.floor(Date.now() / 1000);
    if (typeof rec.exp === 'number' && now >= rec.exp) return null;
    if (typeof rec.nbf === 'number' && now < rec.nbf) return null;
    return {
      v: 1,
      ...(typeof rec.exp === 'number' ? { exp: rec.exp } : {}),
      ...(typeof rec.nbf === 'number' ? { nbf: rec.nbf } : {}),
      ...(typeof rec.sub === 'string' && rec.sub.length > 0 ? { sub: rec.sub } : {}),
    };
  } catch {
    return null;
  }
}
