/**
 * Generate a Weehawk enterprise license token (Ed25519-signed, self-hosted verifies offline).
 *
 * Usage (from apps/api):
 *   export WEEHAWK_ENTERPRISE_LICENSE_PRIVATE_KEY="$(cat path/to/private.pem)"
 *   pnpm run generate-enterprise-license -- --exp-days 365 --sub "order-123"
 *
 * Or pass a PEM file path instead of env:
 *   pnpm run generate-enterprise-license -- --private-key-file ./license-signing.pem --exp-days 0 --sub "dev"
 *
 * Keys (generate once, keep private secret):
 *   openssl genpkey -algorithm ED25519 -out enterprise_license_private.pem
 *   openssl pkey -in enterprise_license_private.pem -pubout -out enterprise_license_public.pem
 *
 * Distribute only the printed single-line token to the customer. They paste it in Profile → Enterprise license
 * or set WEEHAWK_ENTERPRISE_LICENSE_KEY. Ship the matching public PEM in self-hosted via
 * WEEHAWK_ENTERPRISE_LICENSE_PUBLIC_KEY.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildSignedEnterpriseLicenseToken } from '../ee/license-token';

function argValue(name: string): string | undefined {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return undefined;
  return process.argv[idx + 1]?.trim() || undefined;
}

function main(): void {
  const file = argValue('--private-key-file');
  let privatePem = (process.env.WEEHAWK_ENTERPRISE_LICENSE_PRIVATE_KEY ?? '').trim();
  if (file) {
    privatePem = readFileSync(resolve(process.cwd(), file), 'utf8').trim();
  }
  if (!privatePem) {
    console.error(
      'Missing private key: set WEEHAWK_ENTERPRISE_LICENSE_PRIVATE_KEY or pass --private-key-file <path.pem>',
    );
    process.exit(1);
  }

  const expDaysRaw = argValue('--exp-days') ?? '365';
  const expDays = Number(expDaysRaw);
  if (!Number.isFinite(expDays) || expDays < 0) {
    console.error('--exp-days must be a non-negative number (0 = no expiry field)');
    process.exit(1);
  }

  const sub = argValue('--sub')?.trim();

  const now = Math.floor(Date.now() / 1000);
  const payload: { v: 1; exp?: number; sub?: string } = { v: 1 };
  if (expDays > 0) {
    payload.exp = now + Math.floor(expDays * 86400);
  }
  if (sub) {
    payload.sub = sub;
  }

  const token = buildSignedEnterpriseLicenseToken(payload, privatePem);
  process.stdout.write(`${token}\n`);
}

main();
