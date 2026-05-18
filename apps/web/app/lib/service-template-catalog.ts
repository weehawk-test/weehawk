/** Public service template catalog (compose stacks). */

import { normalizeTemplateComposeForDeploy } from "./compose-volume-normalize";

export const TEMPLATE_CATALOG_BRANCH = "main";
export const TEMPLATE_CATALOG_REPO = "weehawkio/weehawk-templates";
/** Weehawk templates catalog (SERVICE_URL_* placeholders); see https://github.com/weehawkio/weehawk-templates */
export const SERVICE_TEMPLATE_CATALOG_JSON_URL = `https://raw.githubusercontent.com/${TEMPLATE_CATALOG_REPO}/${TEMPLATE_CATALOG_BRANCH}/templates/service-templates-latest.json`;
export const TEMPLATE_CATALOG_PUBLIC_RAW_BASE = `https://raw.githubusercontent.com/${TEMPLATE_CATALOG_REPO}/${TEMPLATE_CATALOG_BRANCH}/public`;

export type ServiceTemplateCatalogEntryRaw = {
  documentation?: string;
  slogan: string;
  compose: string;
  tags?: string[];
  category?: string;
  logo?: string;
  minversion?: string;
  port?: string;
};

export type ServiceTemplateCatalogEntry = ServiceTemplateCatalogEntryRaw & {
  id: string;
  displayName: string;
};

let templateCatalogCache: { at: number; templates: ServiceTemplateCatalogEntry[] } | null =
  null;
let inflight: Promise<ServiceTemplateCatalogEntry[]> | null = null;
const CACHE_MS = 60 * 60 * 1000;

export function templateCatalogDisplayName(id: string): string {
  return id
    .split(/[-_]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function templateCatalogLogoUrl(
  logoPath: string | undefined,
  templateId: string,
): string {
  const path = logoPath?.trim() || `svgs/${templateId}.svg`;
  const normalized = path.startsWith("/") ? path.slice(1) : path;
  return `${TEMPLATE_CATALOG_PUBLIC_RAW_BASE}/${normalized}`;
}

export function decodeTemplateComposeBase64(encoded: string): string {
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

function normalizeCatalog(
  raw: Record<string, ServiceTemplateCatalogEntryRaw>,
): ServiceTemplateCatalogEntry[] {
  return Object.entries(raw)
    .map(([id, entry]) => ({
      id,
      ...entry,
      displayName: templateCatalogDisplayName(id),
    }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

export async function fetchServiceTemplateCatalog(): Promise<ServiceTemplateCatalogEntry[]> {
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
    const res = await fetch(SERVICE_TEMPLATE_CATALOG_JSON_URL, { cache: "force-cache" });
    if (!res.ok) {
      throw new Error(`Could not load service templates (HTTP ${res.status})`);
    }
    const json = (await res.json()) as Record<string, ServiceTemplateCatalogEntryRaw>;
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

export function parseTemplateIdFromConfig(config: string): string | null {
  const m = config.match(/^\s*#\s*template:\s*([^\s#]+)/m);
  const id = m?.[1]?.trim();
  return id || null;
}

export function isWeehawkTemplateServiceConfig(config: string): boolean {
  return /^\s*#\s*weehawk template service/m.test(config);
}

export function buildTemplateDockerConfig(
  templateId: string,
  composeYaml: string,
  options?: { port?: string },
): string {
  const body = normalizeTemplateComposeForDeploy(composeYaml.trim());
  let header = `# weehawk template service\n# template: ${templateId}\n# catalog: ${TEMPLATE_CATALOG_BRANCH}\n`;
  const port = options?.port?.trim();
  if (port) header += `# template.port: ${port}\n`;
  return `${header}\n${body}\n`;
}

export function parseTemplatePortFromConfig(config: string): string | undefined {
  const m = config.match(/^\s*#\s*template\.port:\s*(\S+)/m);
  const p = m?.[1]?.trim();
  return p || undefined;
}

export function templateCatalogCategories(
  templates: ServiceTemplateCatalogEntry[],
): string[] {
  const set = new Set<string>();
  for (const t of templates) {
    const c = t.category?.trim();
    if (c) set.add(c);
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}
