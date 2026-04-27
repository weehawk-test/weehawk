import { existsSync, readFileSync } from 'fs';

const RUN_SECRETS = '/run/secrets';

/** Swarm mounts each secret as a file named after the secret. Skip if env is already set (e.g. local .env). */
const SWARM_SECRET_FILES: { name: string; envKey: string }[] = [
  { name: 'weehawk_db_password', envKey: 'DB_PASSWORD' },
  { name: 'weehawk_jwt_secret', envKey: 'auth.jwtSecret' },
  { name: 'weehawk_encryption_key', envKey: 'WEEHAWK_ENCRYPTION_KEY' },
  { name: 'weehawk_refresh_token_hash_secret', envKey: 'REFRESH_TOKEN_HASH_SECRET' },
  { name: 'weehawk_google_client_secret', envKey: 'google.clientSecret' },
  // Support both legacy and current secret names for SMTP password.
  { name: 'weehawk_mail_pass', envKey: 'MAIL_PASS' },
  { name: 'weehawk_mail_password', envKey: 'MAIL_PASS' },
  { name: 'weehawk_api_key', envKey: 'WEEHAWK_API_KEY' },
];

for (const { name, envKey } of SWARM_SECRET_FILES) {
  if (process.env[envKey]) continue;
  const fullPath = `${RUN_SECRETS}/${name}`;
  if (!existsSync(fullPath)) continue;
  const value = readFileSync(fullPath, 'utf8').trim();
  if (value !== '') process.env[envKey] = value;
}
