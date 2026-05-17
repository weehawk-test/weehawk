/** Coolify service templates (v4.x). Source: https://github.com/coollabsio/coolify/tree/v4.x/templates */

import { ensureComposeNamedVolumesDeclared } from "./compose-volume-normalize";

export const COOLIFY_TEMPLATES_BRANCH = "v4.x";
export const COOLIFY_TEMPLATES_JSON_URL = `https://raw.githubusercontent.com/coollabsio/coolify/${COOLIFY_TEMPLATES_BRANCH}/templates/service-templates.json`;
export const COOLIFY_PUBLIC_RAW_BASE = `https://raw.githubusercontent.com/coollabsio/coolify/${COOLIFY_TEMPLATES_BRANCH}/public`;

export type CoolifyServiceTemplateRaw = {
  documentation?: string;
  slogan: string;
  compose: string;
  tags?: string[];
  category?: string;
  logo?: string;
  minversion?: string;
  port?: string;
};

export type CoolifyServiceTemplate = CoolifyServiceTemplateRaw & {
  id: string;
  displayName: string;
};

let templateCatalogCache: { at: number; templates: CoolifyServiceTemplate[] } | null = null;
let inflight: Promise<CoolifyServiceTemplate[]> | null = null;
const CACHE_MS = 60 * 60 * 1000;

export function coolifyTemplateDisplayName(id: string): string {
  return id
    .split(/[-_]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function coolifyTemplateLogoUrl(logoPath: string | undefined, templateId: string): string {
  const path = logoPath?.trim() || `svgs/${templateId}.svg`;
  const normalized = path.startsWith("/") ? path.slice(1) : path;
  return `${COOLIFY_PUBLIC_RAW_BASE}/${normalized}`;
}

export function decodeCoolifyComposeBase64(encoded: string): string {
  const trimmed = encoded.trim();
  if (!trimmed) return "";
  try {
    if (typeof atob === "function") {
      const binary = atob(trimmed);
      const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
      return new TextDecoder().decode(bytes);
    }
    return Buffer.from(trimmed, "base64").toString("utf-8");
  } catch {
    return "";
  }
}

function normalizeCatalog(raw: Record<string, CoolifyServiceTemplateRaw>): CoolifyServiceTemplate[] {
  return Object.entries(raw)
    .map(([id, entry]) => ({
      id,
      ...entry,
      displayName: coolifyTemplateDisplayName(id),
    }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

export async function fetchCoolifyServiceTemplates(): Promise<CoolifyServiceTemplate[]> {
  const now = Date.now();
  if (
    templateCatalogCache &&
    now - templateCatalogCache.at < CACHE_MS &&
    templateCatalogCache.templates.length > 0
  ) {
    return templateCatalogCache.templates;
  }
  if (inflight) return inflight;

  inflight = (async () => {
    const res = await fetch(COOLIFY_TEMPLATES_JSON_URL, { cache: "force-cache" });
    if (!res.ok) {
      throw new Error(`Could not load Coolify templates (HTTP ${res.status})`);
    }
    const json = (await res.json()) as Record<string, CoolifyServiceTemplateRaw>;
    const templates = normalizeCatalog(json);
    templateCatalogCache = { at: Date.now(), templates };
    return templates;
  })();

  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}

export function parseCoolifyTemplateIdFromConfig(config: string): string | null {
  const m = config.match(/^\s*#\s*template:\s*([^\s#]+)/m);
  const id = m?.[1]?.trim();
  return id || null;
}

export function isCoolifyTemplateServiceConfig(config: string): boolean {
  return /^\s*#\s*weehawk template service/m.test(config);
}

export function buildCoolifyTemplateDockerConfig(
  templateId: string,
  composeYaml: string,
  options?: { port?: string },
): string {
  const body = ensureComposeNamedVolumesDeclared(composeYaml.trim());
  let header = `# weehawk template service\n# template: ${templateId}\n# source: coolify/${COOLIFY_TEMPLATES_BRANCH}\n`;
  const port = options?.port?.trim();
  if (port) header += `# template.port: ${port}\n`;
  return `${header}\n${body}\n`;
}

export function parseTemplatePortFromConfig(config: string): string | undefined {
  const m = config.match(/^\s*#\s*template\.port:\s*(\S+)/m);
  const p = m?.[1]?.trim();
  return p || undefined;
}

export function coolifyTemplateCategories(templates: CoolifyServiceTemplate[]): string[] {
  const set = new Set<string>();
  for (const t of templates) {
    const c = t.category?.trim();
    if (c) set.add(c);
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}
