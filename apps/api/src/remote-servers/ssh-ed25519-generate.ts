import { generateKeyPairSync, randomInt, type JsonWebKey } from 'crypto';

const AUTH_MAGIC = Buffer.from('openssh-key-v1\0', 'ascii');

function uint32BE(n: number): Buffer {
  const b = Buffer.allocUnsafe(4);
  b.writeUInt32BE(n, 0);
  return b;
}

/** SSH wire "string": uint32 length + raw bytes */
function sshString(buf: Buffer): Buffer {
  return Buffer.concat([uint32BE(buf.length), buf]);
}

/** Public key blob (same bytes as base64 in `ssh-ed25519 AAA...` line, before comment). */
function ed25519PublicKeyBlob(pub32: Buffer): Buffer {
  return Buffer.concat([
    sshString(Buffer.from('ssh-ed25519', 'ascii')),
    sshString(pub32),
  ]);
}

/**
 * OpenSSH `authorized_keys` line (same shape as `ssh-keygen -t ed25519` .pub).
 */
function opensshEd25519PublicLine(pubJwk: JsonWebKey, comment: string): string {
  const x = pubJwk.x;
  if (typeof x !== 'string' || !x.length) {
    throw new Error('Invalid Ed25519 JWK: missing x');
  }
  const rawPub = Buffer.from(x, 'base64url');
  if (rawPub.length !== 32) {
    throw new Error(`Invalid Ed25519 public key length: ${rawPub.length}`);
  }
  const blob = ed25519PublicKeyBlob(rawPub);
  return `ssh-ed25519 ${blob.toString('base64')} ${comment}`;
}

/**
 * Padded plaintext for the inner private-key string (checkints + ssh-ed25519 block + padding).
 * Matches OpenSSH `sshkey_private_encode` layout for ed25519.
 */
function ed25519PrivatePlaintext(
  seed32: Buffer,
  pub32: Buffer,
  comment: string,
): Buffer {
  const priv64 = Buffer.concat([seed32, pub32]);
  const check = randomInt(0, 0xffffffff);
  let p = Buffer.concat([
    uint32BE(check),
    uint32BE(check),
    sshString(Buffer.from('ssh-ed25519', 'ascii')),
    sshString(pub32),
    sshString(priv64),
    sshString(Buffer.from(comment, 'utf8')),
  ]);
  let pad = 1;
  while (p.length % 8 !== 0) {
    p = Buffer.concat([p, Buffer.from([pad & 0xff])]);
    pad += 1;
  }
  return p;
}

/** Binary `openssh-key-v1` file body (same format as `ssh-keygen` unencrypted keys). */
function encodeOpensshKeyV1Unencrypted(
  pub32: Buffer,
  privPlain: Buffer,
): Buffer {
  const pubBlob = ed25519PublicKeyBlob(pub32);
  return Buffer.concat([
    AUTH_MAGIC,
    sshString(Buffer.from('none', 'ascii')),
    sshString(Buffer.from('none', 'ascii')),
    sshString(Buffer.alloc(0)),
    uint32BE(1),
    sshString(pubBlob),
    sshString(privPlain),
  ]);
}

function wrapOpensshPrivateKeyPem(binary: Buffer): string {
  const b64 = binary.toString('base64');
  const lines = b64.match(/.{1,70}/g) ?? [b64];
  return [
    '-----BEGIN OPENSSH PRIVATE KEY-----',
    ...lines,
    '-----END OPENSSH PRIVATE KEY-----',
  ].join('\n');
}

/**
 * Ed25519 key pair using Node.js `crypto` only — **OpenSSH PEM** + `.pub` line (same styles as `ssh-keygen`).
 */
export function generateEd25519SshKeyPair(comment = 'weehawk_ed25519'): {
  privateKey: string;
  publicKey: string;
} {
  const { publicKey: pubJwk, privateKey: privJwk } = generateKeyPairSync(
    'ed25519',
    {
      publicKeyEncoding: { format: 'jwk' },
      privateKeyEncoding: { format: 'jwk' },
    },
  ) as unknown as { publicKey: JsonWebKey; privateKey: JsonWebKey };

  const d = privJwk.d;
  const x = pubJwk.x;
  if (typeof d !== 'string' || typeof x !== 'string') {
    throw new Error('Expected Ed25519 JWK with d and x');
  }
  const seed32 = Buffer.from(d, 'base64url');
  const pub32 = Buffer.from(x, 'base64url');
  if (seed32.length !== 32 || pub32.length !== 32) {
    throw new Error('Invalid Ed25519 JWK key material length');
  }

  const privPlain = ed25519PrivatePlaintext(seed32, pub32, comment);
  const fileBody = encodeOpensshKeyV1Unencrypted(pub32, privPlain);
  return {
    privateKey: wrapOpensshPrivateKeyPem(fileBody),
    publicKey: opensshEd25519PublicLine(pubJwk, comment),
  };
}
