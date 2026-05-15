import { generateKeyPairSync } from 'node:crypto';
import {
  buildSignedEnterpriseLicenseToken,
  verifySignedEnterpriseLicenseToken,
} from './enterprise-license-token';

describe('enterprise-license-token', () => {
  it('round-trips and enforces exp', () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const privPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const pubPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();

    const now = Math.floor(Date.now() / 1000);
    const token = buildSignedEnterpriseLicenseToken(
      { v: 1, exp: now + 3600, sub: 'customer-a' },
      privPem,
    );
    const ok = verifySignedEnterpriseLicenseToken(token, pubPem);
    expect(ok).toEqual(expect.objectContaining({ v: 1, sub: 'customer-a' }));

    const expired = buildSignedEnterpriseLicenseToken({ v: 1, exp: now - 10 }, privPem);
    expect(verifySignedEnterpriseLicenseToken(expired, pubPem)).toBeNull();
  });

  it('accepts SPKI public key as single-line base64 (not only PEM)', () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const privPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const spkiDer = publicKey.export({ type: 'spki', format: 'der' }) as Buffer;
    const spkiB64 = spkiDer.toString('base64');
    const token = buildSignedEnterpriseLicenseToken({ v: 1 }, privPem);
    expect(verifySignedEnterpriseLicenseToken(token, spkiB64)).toEqual(
      expect.objectContaining({ v: 1 }),
    );
  });

  it('rejects tampered token', () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const privPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const pubPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const token = buildSignedEnterpriseLicenseToken({ v: 1 }, privPem);
    const parts = token.split('.');
    expect(parts.length).toBe(3);
    const tampered = `${parts[0]}.${`${parts[1]}x`}.${parts[2]}`;
    expect(verifySignedEnterpriseLicenseToken(tampered, pubPem)).toBeNull();
  });
});
