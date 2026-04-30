import { ValueTransformer } from 'typeorm';
import {
  decryptPrivateKey,
  encryptPrivateKey,
} from '../remote-servers/ssh-key-crypto';

const IV_LEN = 12;
const TAG_LEN = 16;

function encryptionSecret(): string {
  return (process.env.WEEHAWK_ENCRYPTION_KEY ?? '').trim();
}

function looksLikeOurCiphertext(raw: string): boolean {
  if (raw.length < 40) return false;
  try {
    const buf = Buffer.from(raw, 'base64');
    return buf.length >= IV_LEN + TAG_LEN + 1;
  } catch {
    return false;
  }
}

/**
 * Stores service .env text encrypted at rest.
 * Falls back to plaintext read for legacy rows.
 */
export const serviceEnvTransformer: ValueTransformer = {
  to: (entityValue: string | null | undefined): string | null => {
    if (entityValue == null) return null;
    const raw = String(entityValue);
    if (!raw.trim()) return raw;
    const secret = encryptionSecret();
    if (!secret) {
      throw new Error(
        'WEEHAWK_ENCRYPTION_KEY is not set. It is required to store encrypted service env values.',
      );
    }
    return encryptPrivateKey(raw, secret);
  },
  from: (dbValue: unknown): string | null => {
    if (dbValue == null) return null;
    const raw = String(dbValue);
    if (!raw.trim()) return raw;

    const secret = encryptionSecret();
    if (!secret && looksLikeOurCiphertext(raw)) {
      throw new Error(
        'WEEHAWK_ENCRYPTION_KEY is not set but service env is encrypted in the database.',
      );
    }
    if (secret) {
      try {
        return decryptPrivateKey(raw, secret);
      } catch {
        if (looksLikeOurCiphertext(raw)) {
          throw new Error(
            'Could not decrypt service env. Ensure WEEHAWK_ENCRYPTION_KEY matches the value used when env was saved.',
          );
        }
      }
    }
    return raw;
  },
};
