import 'reflect-metadata';
import '../load-docker-secrets';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { randomBytes } from 'crypto';
import * as bcrypt from 'bcrypt';
import { DataSource, type DataSourceOptions } from 'typeorm';
import { User } from '../auth/entities/user.entity';
import { RefreshToken } from '../token/refresh-token.entity';

/** Tiny .env loader so this script works without booting Nest/ConfigModule. process.env wins. */
function loadEnvFile(path: string): void {
  if (!existsSync(path)) return;
  const text = readFileSync(path, 'utf8');
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] == null || process.env[key] === '') {
      process.env[key] = value;
    }
  }
}

/** Unbiased random password from a confusion-free alphabet (no 0/O, 1/l/I). */
function generateRandomPassword(length: number): string {
  const ALPHABET =
    'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const cutoff = Math.floor(256 / ALPHABET.length) * ALPHABET.length;
  const out: string[] = [];
  while (out.length < length) {
    const buf = randomBytes(length * 2);
    for (let i = 0; i < buf.length && out.length < length; i++) {
      const b = buf[i];
      if (b < cutoff) out.push(ALPHABET[b % ALPHABET.length]);
    }
  }
  return out.join('');
}

async function main(): Promise<number> {
  // Try common locations whether invoked from `apps/api` or repo root.
  for (const candidate of [
    '.env',
    'apps/api/.env',
    resolve(__dirname, '..', '..', '.env'),
  ]) {
    loadEnvFile(candidate);
  }

  const options: DataSourceOptions = {
    type: ((process.env.DB_TYPE ?? 'postgres').trim().toLowerCase() ||
      'postgres') as DataSourceOptions['type'],
    host: process.env.DB_HOST ?? 'localhost',
    port: Number(process.env.DB_PORT ?? 5432),
    username: process.env.DB_USERNAME ?? 'postgres',
    password: process.env.DB_PASSWORD ?? 'postgres',
    database: process.env.DB_DATABASE ?? 'weehawk',
    entities: [User, RefreshToken],
    synchronize: false,
  } as DataSourceOptions;

  const ds = new DataSource(options);
  await ds.initialize();
  try {
    const repo = ds.getRepository(User);
    const user = await repo.findOne({ where: {}, order: { id: 'ASC' } });
    if (!user) {
      console.error('Error: No Admin account found.');
      return 1;
    }
    const newPassword = generateRandomPassword(10);
    user.passwordHash = await bcrypt.hash(newPassword, 10);
    user.updatedAt = new Date();
    await repo.save(user);
    console.log(`Success! Your new Admin password is: ${newPassword}`);
    return 0;
  } finally {
    await ds.destroy();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error('reset-mypassword failed:', err);
    process.exit(1);
  });
