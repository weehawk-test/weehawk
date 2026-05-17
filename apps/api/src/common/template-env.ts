/**
 * Unified template environment generation (create + deploy).
 * Fills every SERVICE_* / compose placeholder so `docker stack deploy` does not warn.
 */

import { randomBytes } from 'crypto';

export type TemplateEnvBuildContext = {
  appName: string;
  serviceName: string;
  templateId?: string;
  templatePort?: string;
};

type ExtractedVar = {
  key: string;
  defaultValue?: string;
};

const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

function randomHex(byteLength: number): string {
  return randomBytes(byteLength).toString('hex');
}

function randomAlphanumeric(length: number): string {
  const chars =
    'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const buf = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) {
    out += chars[buf[i]! % chars.length];
  }
  return out;
}

function randomBase64Url(byteLength: number): string {
  return randomBytes(byteLength)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
    .slice(0, 64);
}

/** Collect every env key referenced anywhere in a template compose file. */
export function extractTemplateEnvKeysFromCompose(
  composeYaml: string,
): ExtractedVar[] {
  const byKey = new Map<string, ExtractedVar>();
  const add = (key: string, defaultValue?: string) => {
    const k = key.trim();
    if (!k || !ENV_KEY.test(k)) return;
    const prev = byKey.get(k);
    if (!prev) {
      byKey.set(k, { key: k, defaultValue });
      return;
    }
    if (defaultValue !== undefined && prev.defaultValue === undefined) {
      byKey.set(k, { key: k, defaultValue });
    }
  };

  const text = composeYaml || '';

  for (const m of text.matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*):\?\}/g)) {
    add(m[1]!);
  }
  for (const m of text.matchAll(
    /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*)|-([^}]*))\}/g,
  )) {
    add(m[1]!, (m[2] ?? m[3])?.trim());
  }
  for (const m of text.matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g)) {
    const full = m[0] ?? '';
    if (full.includes(':')) continue;
    add(m[1]!);
  }
  for (const m of text.matchAll(/\$([A-Za-z_][A-Za-z0-9_]+)/g)) {
    if ((m[0] ?? '').startsWith('${')) continue;
    add(m[1]!);
  }
  for (const m of text.matchAll(/^\s*-\s+([A-Za-z_][A-Za-z0-9_]+)\s*$/gm)) {
    add(m[1]!);
  }

  for (const m of text.matchAll(/\b(SERVICE_[A-Z][A-Z0-9_]*)\b/g)) {
    add(m[1]!);
  }

  return Array.from(byKey.values()).sort((a, b) => a.key.localeCompare(b.key));
}

/** User-provided integrations — never invent random credentials. */
function isOptionalExternalIntegrationKey(key: string): boolean {
  const u = key.toUpperCase();
  return (
    u.startsWith('SMTP_') ||
    u.startsWith('INF_APP_CONNECTION_') ||
    u.startsWith('MAILGUN_') ||
    u.startsWith('SENDGRID_') ||
    u.startsWith('OAUTH_') ||
    u.startsWith('OIDC_') ||
    u.startsWith('SAML_') ||
    u.startsWith('LDAP_') ||
    u.startsWith('STRIPE_') ||
    u.startsWith('TWILIO_') ||
    u.startsWith('DISCORD_') ||
    u.startsWith('SLACK_')
  );
}

function inferDefaultForKey(
  key: string,
  ctx: TemplateEnvBuildContext,
): string | undefined {
  const slug = (ctx.templateId ?? ctx.appName)
    .replace(/-/g, '_')
    .replace(/[^a-z0-9_]/gi, '')
    .slice(0, 48);
  const port = ctx.templatePort?.trim() || '80';
  const u = key.toUpperCase();

  if (u === 'POSTGRES_DB' || u === 'MYSQL_DATABASE' || u === 'MARIADB_DATABASE') {
    return slug || 'app';
  }
  if (u === 'POSTGRES_HOST' || u === 'MYSQL_HOST' || u === 'MARIADB_HOST') {
    return u.startsWith('POSTGRES')
      ? 'postgres'
      : u.startsWith('MYSQL')
        ? 'mysql'
        : 'mariadb';
  }
  if (u === 'POSTGRES_PORT') return '5432';
  if (u === 'MYSQL_PORT' || u === 'MARIADB_PORT') return '3306';
  if (u === 'REDIS_HOST') return 'redis';
  if (u === 'REDIS_PORT') return '6379';
  if (u === 'MONGO_INITDB_DATABASE') return slug || 'app';

  if (u.startsWith('SERVICE_FQDN_') || u.startsWith('SERVICE_URL_')) {
    return `http://127.0.0.1:${port}`;
  }

  if (u.endsWith('_EMAIL') || u.includes('EMAIL')) {
    return `admin@${slug || 'localhost'}.local`;
  }

  return undefined;
}

function looksLikeSecretKey(key: string): boolean {
  const u = key.toUpperCase();
  return (
    u.startsWith('SERVICE_PASSWORD') ||
    u.includes('PASSWORD') ||
    u.includes('SECRET') ||
    u.endsWith('_KEY') ||
    u.includes('API_KEY') ||
    u.includes('APIKEY') ||
    u.includes('ENCRYPTION') ||
    u.includes('TOKEN') ||
    u.includes('AUTH')
  );
}

function generateValueForKey(
  key: string,
  ctx: TemplateEnvBuildContext,
  defaultValue?: string,
): string {
  if (isOptionalExternalIntegrationKey(key)) {
    return defaultValue?.length ? defaultValue : '';
  }

  // ${VAR:-default} in compose (e.g. ALLOW_EMPTY_PASSWORD:-yes, NODE_ENV:-production)
  if (
    defaultValue !== undefined &&
    defaultValue.length > 0 &&
    !key.startsWith('SERVICE_PASSWORD')
  ) {
    return defaultValue;
  }

  if (key.startsWith('SERVICE_PASSWORD_64_')) {
    return randomBase64Url(48);
  }
  if (key.startsWith('SERVICE_PASSWORD_')) {
    return randomAlphanumeric(32);
  }
  if (key.startsWith('SERVICE_USER_')) {
    const role = key.slice('SERVICE_USER_'.length).toLowerCase();
    if (role === 'postgres' || role === 'mysql' || role === 'mariadb') {
      return role;
    }
    if (role === 'mongodb' || role === 'mongo') return 'mongodb';
    if (role === 'redis') return 'default';
    return `user_${randomHex(4)}`;
  }
  if (key.startsWith('SERVICE_FQDN_') || key.startsWith('SERVICE_URL_')) {
    return inferDefaultForKey(key, ctx) ?? `http://127.0.0.1`;
  }

  if (looksLikeSecretKey(key)) {
    return randomAlphanumeric(24);
  }

  const inferred = inferDefaultForKey(key, ctx);
  if (inferred !== undefined) return inferred;

  if (defaultValue !== undefined && defaultValue.length > 0) {
    return defaultValue;
  }

  return randomAlphanumeric(16);
}

export function buildTemplateEnvVars(
  composeYaml: string,
  ctx: TemplateEnvBuildContext,
): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const { key, defaultValue } of extractTemplateEnvKeysFromCompose(
    composeYaml,
  )) {
    vars[key] = generateValueForKey(key, ctx, defaultValue);
  }
  return vars;
}

/** Merge auto-generated template vars; `userEnv` wins on conflict. */
export function mergeTemplateDeployEnv(
  composeYaml: string,
  ctx: TemplateEnvBuildContext,
  userEnv: Record<string, string>,
): Record<string, string> {
  const generated = buildTemplateEnvVars(composeYaml, ctx);
  return { ...generated, ...userEnv };
}
