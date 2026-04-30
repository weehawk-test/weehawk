import { randomBytes } from 'crypto';

const PUBLIC_ID_ALPHABET =
  '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const PUBLIC_ID_DEFAULT_LENGTH = 12;

function randomChar(): string {
  const idx = randomBytes(1)[0] % PUBLIC_ID_ALPHABET.length;
  return PUBLIC_ID_ALPHABET[idx];
}

export function generatePublicId(
  prefix?: string,
  length = PUBLIC_ID_DEFAULT_LENGTH,
): string {
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += randomChar();
  }
  if (!prefix) return out;
  return `${prefix}_${out}`;
}

export function isLikelyNumericId(raw: string): boolean {
  return /^[0-9]+$/.test(String(raw).trim());
}
