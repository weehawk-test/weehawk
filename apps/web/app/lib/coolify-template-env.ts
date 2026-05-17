/**
 * Build a Weehawk `.env` from Coolify-style compose placeholders:
 * - ${VAR:?}  required (must be set in .env)
 * - ${VAR:-default}
 * - ${VAR}
 * - $SERVICE_PASSWORD_*
 * - bare `SERVICE_FQDN_*` list items
 */

export type CoolifyEnvBuildContext = {
  appName: string;
  serviceName: string;
  templateId?: string;
  /** Host port hint from template catalog (e.g. "80"). */
  templatePort?: string;
};

type ExtractedVar = {
  key: string;
  defaultValue?: string;
};

const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

function randomHex(byteLength: number): string {
  const arr = new Uint8Array(byteLength);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}

function randomAlphanumeric(length: number): string {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const arr = new Uint8Array(length);
  crypto.getRandomValues(arr);
  let out = "";
  for (let i = 0; i < length; i++) {
    out += chars[arr[i]! % chars.length];
  }
  return out;
}

function randomBase64Url(byteLength: number): string {
  const arr = new Uint8Array(byteLength);
  crypto.getRandomValues(arr);
  let binary = "";
  for (const b of arr) binary += String.fromCharCode(b);
  const b64 = btoa(binary);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

/** Extract variable names referenced in compose `environment:` blocks. */
export function extractCoolifyEnvKeysFromCompose(composeYaml: string): ExtractedVar[] {
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

  const text = composeYaml || "";

  // ${VAR:?} — required substitution (pgAdmin, many Coolify templates)
  for (const m of text.matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*):\?\}/g)) {
    add(m[1]!);
  }

  // ${VAR:-default} or ${VAR-default}
  for (const m of text.matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*)|-([^}]*))\}/g)) {
    add(m[1]!, (m[2] ?? m[3])?.trim());
  }

  // ${VAR} without :- or :? modifier
  for (const m of text.matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g)) {
    const full = m[0] ?? "";
    if (full.includes(":")) continue;
    add(m[1]!);
  }

  // $VAR (Coolify secrets / URLs, not ${...})
  for (const m of text.matchAll(/\$([A-Za-z_][A-Za-z0-9_]+)/g)) {
    const full = m[0] ?? "";
    if (full.startsWith("${")) continue;
    add(m[1]!);
  }

  // - SERVICE_FQDN_APP (value pulled from env key with same name)
  for (const m of text.matchAll(/^\s*-\s+([A-Za-z_][A-Za-z0-9_]+)\s*$/gm)) {
    add(m[1]!);
  }

  // Every Coolify SERVICE_* token anywhere (multi-service templates)
  for (const m of text.matchAll(/\b(SERVICE_[A-Z][A-Z0-9_]*)\b/g)) {
    add(m[1]!);
  }

  return Array.from(byKey.values()).sort((a, b) => a.key.localeCompare(b.key));
}

function inferDefaultForKey(key: string, ctx: CoolifyEnvBuildContext): string | undefined {
  const slug = (ctx.templateId ?? ctx.appName).replace(/-/g, "_").replace(/[^a-z0-9_]/gi, "").slice(0, 48);
  const port = ctx.templatePort?.trim() || "80";
  const u = key.toUpperCase();

  if (u === "POSTGRES_DB" || u === "MYSQL_DATABASE" || u === "MARIADB_DATABASE") {
    return slug || "app";
  }
  if (u === "POSTGRES_HOST" || u === "MYSQL_HOST" || u === "MARIADB_HOST") {
    return u.startsWith("POSTGRES") ? "postgres" : u.startsWith("MYSQL") ? "mysql" : "mariadb";
  }
  if (u === "POSTGRES_PORT") return "5432";
  if (u === "MYSQL_PORT" || u === "MARIADB_PORT") return "3306";
  if (u === "REDIS_HOST") return "redis";
  if (u === "REDIS_PORT") return "6379";
  if (u === "MONGO_INITDB_DATABASE") return slug || "app";

  if (u.startsWith("SERVICE_FQDN_") || u.startsWith("SERVICE_URL_")) {
    return `http://127.0.0.1:${port}`;
  }

  if (u.endsWith("_EMAIL") || u.includes("EMAIL")) {
    return `admin@${slug || "localhost"}.local`;
  }

  return undefined;
}

function looksLikeSecretKey(key: string): boolean {
  const u = key.toUpperCase();
  return (
    u.startsWith("SERVICE_PASSWORD") ||
    u.includes("PASSWORD") ||
    u.includes("SECRET") ||
    u.endsWith("_KEY") ||
    u.includes("API_KEY") ||
    u.includes("APIKEY") ||
    u.includes("ENCRYPTION") ||
    u.includes("TOKEN") ||
    u.includes("AUTH")
  );
}

function generateValueForKey(key: string, ctx: CoolifyEnvBuildContext, defaultValue?: string): string {
  if (defaultValue !== undefined && defaultValue.length > 0 && !looksLikeSecretKey(key)) {
    return defaultValue;
  }

  if (key.startsWith("SERVICE_PASSWORD_64_")) {
    return randomBase64Url(48).slice(0, 64);
  }
  if (key.startsWith("SERVICE_PASSWORD_")) {
    return randomAlphanumeric(32);
  }
  if (key.startsWith("SERVICE_USER_")) {
    const role = key.slice("SERVICE_USER_".length).toLowerCase();
    if (role === "postgres" || role === "mysql" || role === "mariadb") return role;
    if (role === "mongodb" || role === "mongo") return "mongodb";
    if (role === "redis") return "default";
    return `user_${randomHex(4)}`;
  }
  if (key.startsWith("SERVICE_FQDN_") || key.startsWith("SERVICE_URL_")) {
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

export function buildCoolifyTemplateEnvVars(
  composeYaml: string,
  ctx: CoolifyEnvBuildContext,
): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const { key, defaultValue } of extractCoolifyEnvKeysFromCompose(composeYaml)) {
    vars[key] = generateValueForKey(key, ctx, defaultValue);
  }
  return vars;
}

function escapeEnvValue(value: string): string {
  if (/^[a-zA-Z0-9_./:@-]+$/.test(value)) return value;
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;
}

export function formatCoolifyTemplateEnvFile(vars: Record<string, string>): string {
  const keys = Object.keys(vars).sort((a, b) => a.localeCompare(b));
  if (keys.length === 0) return "";

  const lines = [
    "# Generated from Coolify template compose (weehawk)",
    "# Includes ${VAR:?} required keys — edit before production.",
    "",
  ];
  for (const key of keys) {
    lines.push(`${key}=${escapeEnvValue(vars[key]!)}`);
  }
  return `${lines.join("\n")}\n`;
}

export function buildCoolifyTemplateEnvFromCompose(
  composeYaml: string,
  ctx: CoolifyEnvBuildContext,
): string {
  return formatCoolifyTemplateEnvFile(buildCoolifyTemplateEnvVars(composeYaml, ctx));
}
