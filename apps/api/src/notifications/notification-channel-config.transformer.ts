import { ValueTransformer } from 'typeorm';
import { decryptPrivateKey, encryptPrivateKey } from '../remote-servers/ssh-key-crypto';

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
 * Persists {@link NotificationChannel.config} as AES-256-GCM ciphertext (base64)
 * using {@link encryptPrivateKey} / {@link decryptPrivateKey} and `WEEHAWK_ENCRYPTION_KEY`.
 *
 * Older rows may still be plain JSON (`simple-json`); those are read without decrypt.
 */
export const notificationChannelConfigTransformer: ValueTransformer = {
  to: (entityValue: Record<string, unknown> | null): string | null => {
    if (entityValue == null) return null;
    const secret = encryptionSecret();
    if (!secret) {
      throw new Error(
        'WEEHAWK_ENCRYPTION_KEY is not set. It is required to store notification channel credentials.',
      );
    }
    return encryptPrivateKey(JSON.stringify(entityValue), secret);
  },
  from: (dbValue: unknown): Record<string, unknown> | null => {
    if (dbValue == null) return null;
    if (typeof dbValue === 'object' && !Array.isArray(dbValue)) {
      return dbValue as Record<string, unknown>;
    }
    const raw = String(dbValue).trim();
    if (!raw) return null;
    const secret = encryptionSecret();
    if (!secret && looksLikeOurCiphertext(raw)) {
      throw new Error(
        'WEEHAWK_ENCRYPTION_KEY is not set but notification channel config is encrypted in the database.',
      );
    }
    if (secret) {
      try {
        const plain = decryptPrivateKey(raw, secret);
        return JSON.parse(plain) as Record<string, unknown>;
      } catch {
        if (looksLikeOurCiphertext(raw)) {
          throw new Error(
            'Could not decrypt notification channel config. Ensure WEEHAWK_ENCRYPTION_KEY matches the value used when the channel was saved.',
          );
        }
      }
    }
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return null;
    }
  },
};
