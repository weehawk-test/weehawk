import { API_BASE, wsBase, wsBaseCandidates } from "./api";
import { authFetch } from "./auth-fetch";
import type { CreateServiceInput, Service, ServiceType, TraefikRouteRule } from "./schema";
import type { DatabaseEngineId } from "./database-engines";
import type { DatabaseBackupConfig } from "./database-backup-preview";
import { getServerApiBase } from "./server-api";

function nestErrorMessage(text: string, fallback: string): string {
  try {
    const j = JSON.parse(text) as {
      message?: string | string[] | { error?: string; message?: string };
      error?: string;
    };
    if (typeof j.message === "string") return j.message;
    if (Array.isArray(j.message)) return j.message.join(", ");
    if (j.message && typeof j.message === "object") {
      if (typeof j.message.error === "string") return j.message.error;
      if (typeof j.message.message === "string") return j.message.message;
    }
    if (typeof j.error === "string") return j.error;
  } catch {
    /* keep fallback */
  }
  return text.trim() || fallback;
}

async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const base = typeof window === "undefined" ? getServerApiBase() : API_BASE;
  const url = `${base}${path}`;
  const isFormData = typeof FormData !== "undefined" && init?.body instanceof FormData;
  const headers: HeadersInit = {
    Accept: "application/json",
    ...(!isFormData && init?.body ? { "Content-Type": "application/json" } : {}),
    ...init?.headers,
  };
  if (typeof window !== "undefined") {
    return authFetch("cookie-session", url, {
      ...init,
      cache: "no-store",
      headers,
    });
  }
  return fetch(url, {
    ...init,
    cache: "no-store",
    headers,
  });
}

/** Produces a valid `appName` for CreateServiceDto `@Matches` (lowercase, start/end letter). */
export function deriveAppNameFromServiceName(name: string): string {
  let s = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/--+/g, "-");
  if (!s) s = "app";
  if (!/^[a-z]/.test(s)) s = `a${s}`;
  if (!/[a-z]$/.test(s)) s = `${s}a`;
  if (s.length > 100) s = s.slice(0, 100);
  return s.replace(/--+/g, "-");
}

function parseTraefikRoutes(raw: unknown): TraefikRouteRule[] {
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw) as unknown;
    } catch {
      return [];
    }
  }
  if (!Array.isArray(raw)) return [];
  const out: TraefikRouteRule[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const router = typeof o.router === "string" ? o.router : "";
    const hosts = Array.isArray(o.hosts)
      ? (o.hosts as unknown[]).filter((h): h is string => typeof h === "string")
      : [];
    if (!router.trim() || hosts.length === 0) continue;
    const pathPrefix =
      o.pathPrefix === null || o.pathPrefix === undefined
        ? null
        : typeof o.pathPrefix === "string"
          ? o.pathPrefix
          : null;
    let port: number | null | undefined;
    if (o.port === null || o.port === undefined) port = null;
    else if (typeof o.port === "number" && Number.isFinite(o.port)) port = o.port;
    const https = o.https === false ? false : true;
    out.push({
      router: router.trim().toLowerCase(),
      hosts,
      pathPrefix,
      port: port ?? null,
      https,
    });
  }
  return out;
}

function parseRegistryPushImageFromConfig(config: string): string | null {
  const m = config.match(/^\s*#\s*registry\.pushImage:\s*(.+)$/m);
  const t = m?.[1]?.trim();
  return t && t.length > 0 ? t : null;
}

function composeTypeToApi(t: ServiceType): "COMPOSE" | "STACK" | "APPLICATION" | "DATABASES" {
  if (t === "stack") return "STACK";
  if (t === "application") return "APPLICATION";
  if (t === "databases") return "DATABASES";
  return "COMPOSE";
}

function composeTypeFromApi(raw: string): ServiceType {
  const u = String(raw).toUpperCase();
  if (u === "STACK") return "stack";
  if (u === "APPLICATION") return "application";
  if (u === "DATABASES") return "databases";
  return "docker-compose";
}

export const SERVICES_PAGE_SIZE = 8;

export type ServicesPageResponse = {
  data: Service[];
  total: number;
  page: number;
  limit: number;
};

export function parseServicesPageResponse(text: string): ServicesPageResponse {
  const json = JSON.parse(text) as {
    data?: unknown[];
    total?: number;
    page?: number;
    limit?: number;
  };
  if (!Array.isArray(json.data)) {
    return { data: [], total: 0, page: 1, limit: SERVICES_PAGE_SIZE };
  }
  return {
    data: json.data.map(mapApiServiceToService),
    total:
      typeof json.total === "number" && Number.isFinite(json.total)
        ? Math.max(0, json.total)
        : 0,
    page:
      typeof json.page === "number" && Number.isFinite(json.page)
        ? Math.max(1, json.page)
        : 1,
    limit:
      typeof json.limit === "number" && Number.isFinite(json.limit)
        ? Math.max(1, json.limit)
        : SERVICES_PAGE_SIZE,
  };
}

/**
 * Segment for React Query keys like `["service", ownerKey, id]`.
 * Service URLs use `publicId`; API JSON `id` is often the numeric PK — they must not diverge in the cache.
 */
export function serviceQueryKeyId(row: Pick<Service, "id" | "publicId">): string {
  const pub = row.publicId?.trim();
  if (pub) return pub;
  return String(row.id ?? "").trim();
}

export function mapApiServiceToService(row: unknown): Service {
  const s = row as Record<string, unknown>;
  const project = s.project as { id?: number } | undefined;
  const pid = project?.id;
  const projectPublicIdRaw = (project as { publicId?: unknown } | undefined)?.publicId;
  const created = s.createdAt;
  let createdAt: string;
  if (created instanceof Date) createdAt = created.toISOString();
  else if (typeof created === "string") createdAt = created;
  else createdAt = new Date().toISOString();

  const ld = s.lastDeployedAt;
  let lastDeployedAt: string | null = null;
  if (ld instanceof Date) lastDeployedAt = ld.toISOString();
  else if (typeof ld === "string" && ld.length) lastDeployedAt = ld;

  const rs = s.remoteServer as { id?: unknown; name?: unknown } | null | undefined;
  const remoteServerIdRaw = s.remoteServerId;
  let remoteServerId: number | null | undefined;
  if (remoteServerIdRaw === null) {
    remoteServerId = null;
  } else if (typeof remoteServerIdRaw === "number" && Number.isFinite(remoteServerIdRaw)) {
    remoteServerId = remoteServerIdRaw;
  } else if (rs && typeof rs.id === "number") {
    remoteServerId = rs.id;
  }

  const cfg = typeof s.dockerConfig === "string" ? s.dockerConfig : "";

  const brs = s.buildRemoteServer as { id?: unknown; name?: unknown } | null | undefined;
  const buildRemoteServerIdRaw = s.buildRemoteServerId;
  let buildRemoteServerId: number | null | undefined;
  if (buildRemoteServerIdRaw === null) {
    buildRemoteServerId = null;
  } else if (
    typeof buildRemoteServerIdRaw === "number" &&
    Number.isFinite(buildRemoteServerIdRaw)
  ) {
    buildRemoteServerId = buildRemoteServerIdRaw;
  } else if (brs && typeof brs.id === "number") {
    buildRemoteServerId = brs.id;
  }

  return {
    id: String(s.id ?? ""),
    publicId:
      s.publicId == null || String(s.publicId).trim() === ""
        ? undefined
        : String(s.publicId),
    projectId: pid != null ? String(pid) : "",
    projectPublicId:
      projectPublicIdRaw == null || String(projectPublicIdRaw).trim() === ""
        ? undefined
        : String(projectPublicIdRaw),
    name: String(s.name ?? ""),
    type: composeTypeFromApi(String(s.composeType ?? "COMPOSE")),
    config: cfg,
    env: typeof s.env === "string" ? s.env : "",
    description: typeof s.description === "string" ? s.description : "",
    domains: Array.isArray(s.domains) ? (s.domains as string[]).filter((x) => typeof x === "string") : [],
    traefikRoutes: parseTraefikRoutes(s.traefikRoutes),
    createdAt,
    isActive: s.isActive !== false,
    lastDeployedAt,
    appName: typeof s.appName === "string" ? s.appName : undefined,
    remoteServerId,
    remoteServer:
      rs && typeof rs.id === "number" && typeof rs.name === "string"
        ? {
            id: rs.id,
            name: rs.name,
            publicIpv4:
              (rs as { publicIpv4?: string | null }).publicIpv4 === null ||
              (rs as { publicIpv4?: string | null }).publicIpv4 === undefined
                ? null
                : typeof (rs as { publicIpv4?: unknown }).publicIpv4 === "string"
                  ? (rs as { publicIpv4: string }).publicIpv4
                  : null,
            domainsJson:
              (rs as { domainsJson?: string | null }).domainsJson != null &&
              String((rs as { domainsJson?: unknown }).domainsJson).trim()
                ? String((rs as { domainsJson: string }).domainsJson)
                : null,
          }
        : undefined,
    buildRemoteServerId,
    buildRemoteServer:
      brs && typeof brs.id === "number" && typeof brs.name === "string"
        ? { id: brs.id, name: brs.name }
        : undefined,
    buildOnLocalDockerHost:
      s.buildOnLocalDockerHost === true ||
      s.buildOnLocalDockerHost === "true" ||
      s.buildOnLocalDockerHost === 1,
    registryPushImage: parseRegistryPushImageFromConfig(cfg),
    magicTraefikMeUrl:
      s.magicTraefikMeUrl === null || s.magicTraefikMeUrl === undefined
        ? null
        : typeof s.magicTraefikMeUrl === "string"
          ? s.magicTraefikMeUrl
          : null,
    magicTraefikMeIpv4:
      s.magicTraefikMeIpv4 === null || s.magicTraefikMeIpv4 === undefined
        ? null
        : typeof s.magicTraefikMeIpv4 === "string"
          ? s.magicTraefikMeIpv4
          : null,
  };
}

/** Full list when `projectId` is omitted (e.g. webhook/cron pickers), or all services in a project when `projectId` is set (`all=1`). */
export async function fetchServices(projectId?: string): Promise<Service[]> {
  const params = new URLSearchParams();
  if (projectId) {
    params.set("projectId", projectId);
    params.set("all", "1");
  }
  const q = params.toString() ? `?${params.toString()}` : "";
  const res = await apiFetch(`/api/services${q}`);
  const text = await res.text();
  if (!res.ok) {
    throw new Error(nestErrorMessage(text, res.statusText || `HTTP ${res.status}`));
  }
  const data = JSON.parse(text) as unknown;
  if (!Array.isArray(data)) return [];
  return data.map(mapApiServiceToService);
}

export async function fetchServicesPage(
  projectId: string,
  page = 1,
  q = "",
): Promise<ServicesPageResponse> {
  const params = new URLSearchParams();
  params.set("projectId", projectId);
  params.set("page", String(Math.max(1, page)));
  params.set("limit", String(SERVICES_PAGE_SIZE));
  const trimmed = q.trim();
  if (trimmed) params.set("q", trimmed);
  const res = await apiFetch(`/api/services?${params.toString()}`);
  const text = await res.text();
  if (!res.ok) {
    throw new Error(nestErrorMessage(text, res.statusText || `HTTP ${res.status}`));
  }
  return parseServicesPageResponse(text);
}

export async function fetchService(id: string): Promise<Service> {
  const res = await apiFetch(`/api/services/${encodeURIComponent(id)}`);
  const text = await res.text();
  if (!res.ok) {
    throw new Error(nestErrorMessage(text, res.statusText || `HTTP ${res.status}`));
  }
  return mapApiServiceToService(JSON.parse(text));
}

/** Manual opt-in: roll a random Magic traefik.me hostname (stored on the service; updates stack YAML when present). */
export async function rollMagicTraefikMeApi(
  serviceId: string,
  body: { publicIpv4: string },
): Promise<Service> {
  const res = await apiFetch(
    `/api/services/${encodeURIComponent(serviceId)}/magic-traefik-me/roll`,
    { method: "POST", body: JSON.stringify({ publicIpv4: body.publicIpv4 }) },
  );
  const text = await res.text();
  if (!res.ok) {
    throw new Error(nestErrorMessage(text, res.statusText || `HTTP ${res.status}`));
  }
  return mapApiServiceToService(JSON.parse(text));
}

export async function clearMagicTraefikMeApi(serviceId: string): Promise<Service> {
  const res = await apiFetch(`/api/services/${encodeURIComponent(serviceId)}/magic-traefik-me`, {
    method: "DELETE",
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(nestErrorMessage(text, res.statusText || `HTTP ${res.status}`));
  }
  return mapApiServiceToService(JSON.parse(text));
}

export async function createServiceApi(input: CreateServiceInput): Promise<Service> {
  const { databaseEngine, postgres: _postgres, appExternalNetworkNames, appStackNetworkKeys, ...rest } = input;
  let dockerConfig = rest.config?.trim() ? rest.config : "";
  if (rest.type === "databases" && databaseEngine) {
    dockerConfig = `# weehawk database service\n# engine: ${databaseEngine}\n`;
  } else if (rest.type === "application") {
    const extRaw = (appExternalNetworkNames ?? []).map((s) => s.trim()).filter(Boolean);
    const stk = (appStackNetworkKeys ?? []).map((s) => s.trim()).filter(Boolean);
    const ext =
      extRaw.length === 0
        ? ["weehawk"]
        : extRaw.some((n) => n.toLowerCase() === "weehawk")
          ? extRaw
          : ["weehawk", ...extRaw];
    let header = "# weehawk application service\n";
    header += `# app.networks.external: ${ext.join("|")}\n`;
    if (stk.length) header += `# app.networks.stack: ${stk.join("|")}\n`;
    dockerConfig = header;
  }
  const body = {
    name: rest.name,
    appName: deriveAppNameFromServiceName(rest.name),
    composeType: composeTypeToApi(rest.type),
    description: rest.description?.trim() || undefined,
    dockerConfig,
    projectId: Number(rest.projectId),
  };
  const res = await apiFetch("/api/services", {
    method: "POST",
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(nestErrorMessage(text, res.statusText || `HTTP ${res.status}`));
  }
  return mapApiServiceToService(JSON.parse(text));
}

/** Generate Postgres compose from form fields (database-type services, engine postgres). */
export async function applyPostgresDatabaseApi(
  id: string,
  body: {
    dbName: string;
    user?: string;
    pass?: string;
    rootUser?: string;
    rootPass?: string;
    password?: string;
    volumePath?: string;
    replicas?: number;
    publishPort?: number;
    image?: string;
  },
): Promise<Service> {
  const res = await apiFetch(`/api/services/${encodeURIComponent(id)}/database/postgres`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(nestErrorMessage(text, res.statusText || `HTTP ${res.status}`));
  }
  return mapApiServiceToService(JSON.parse(text));
}

export async function applyDatabaseApi(
  id: string,
  engine: DatabaseEngineId,
  body: {
    dbName?: string;
    user?: string;
    pass?: string;
    rootUser?: string;
    rootPass?: string;
    password?: string;
    volumePath?: string;
    replicas?: number;
    publishPort?: number;
    image?: string;
  },
): Promise<Service> {
  const res = await apiFetch(`/api/services/${encodeURIComponent(id)}/database/${encodeURIComponent(engine)}`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(nestErrorMessage(text, res.statusText || `HTTP ${res.status}`));
  }
  return mapApiServiceToService(JSON.parse(text));
}

/** Update Postgres stack YAML after creation: host port and/or replicas (`publishPort: null` unpublishes). */
export async function updatePostgresStackApi(
  id: string,
  body: { publishPort?: number | null; replicas?: number },
): Promise<Service> {
  const res = await apiFetch(`/api/services/${encodeURIComponent(id)}/database/postgres/stack`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(nestErrorMessage(text, res.statusText || `HTTP ${res.status}`));
  }
  return mapApiServiceToService(JSON.parse(text));
}

export async function updateDatabaseStackApi(
  id: string,
  engine: DatabaseEngineId,
  body: { publishPort?: number | null; replicas?: number },
): Promise<Service> {
  const res = await apiFetch(`/api/services/${encodeURIComponent(id)}/database/${encodeURIComponent(engine)}/stack`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(nestErrorMessage(text, res.statusText || `HTTP ${res.status}`));
  }
  return mapApiServiceToService(JSON.parse(text));
}

export async function updateServiceApi(
  id: string,
  patch: Partial<
    Pick<
      Service,
      | "config"
      | "env"
      | "isActive"
      | "description"
      | "domains"
      | "traefikRoutes"
      | "remoteServerId"
      | "buildRemoteServerId"
      | "buildOnLocalDockerHost"
      | "registryPushImage"
      | "magicTraefikMeIpv4"
    >
  >,
): Promise<Service> {
  const body: Record<string, unknown> = {};
  if (patch.config !== undefined) body.dockerConfig = patch.config;
  if (patch.env !== undefined) body.env = patch.env;
  if (patch.isActive !== undefined) body.isActive = patch.isActive;
  if (patch.description !== undefined) body.description = patch.description;
  if (patch.domains !== undefined) body.domains = patch.domains;
  if (patch.traefikRoutes !== undefined) body.traefikRoutes = patch.traefikRoutes;
  if (patch.remoteServerId !== undefined) body.remoteServerId = patch.remoteServerId;
  if (patch.buildRemoteServerId !== undefined)
    body.buildRemoteServerId = patch.buildRemoteServerId;
  if (patch.buildOnLocalDockerHost !== undefined)
    body.buildOnLocalDockerHost = patch.buildOnLocalDockerHost;
  if (patch.registryPushImage !== undefined) body.registryPushImage = patch.registryPushImage;
  if (patch.magicTraefikMeIpv4 !== undefined) body.magicTraefikMeIpv4 = patch.magicTraefikMeIpv4;

  const res = await apiFetch(`/api/services/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(nestErrorMessage(text, res.statusText || `HTTP ${res.status}`));
  }
  return mapApiServiceToService(JSON.parse(text));
}

export async function patchApplicationNetworksApi(
  id: string,
  body: { external: string[]; stack: string[] },
): Promise<Service> {
  const res = await apiFetch(`/api/services/${encodeURIComponent(id)}/application/networks`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(nestErrorMessage(text, res.statusText || `HTTP ${res.status}`));
  }
  return mapApiServiceToService(JSON.parse(text));
}

export async function deleteServiceApi(id: string): Promise<void> {
  const res = await apiFetch(`/api/services/${encodeURIComponent(id)}`, { method: "DELETE" });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(nestErrorMessage(text, res.statusText || `HTTP ${res.status}`));
  }
}

/** Stops containers/stack without deleting the service (see ExecutorService.shutdown). */
export async function shutdownServiceApi(id: string): Promise<{ success: boolean; message?: string }> {
  const res = await apiFetch(`/api/services/${encodeURIComponent(id)}/shutdown`, { method: "POST" });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(nestErrorMessage(text, res.statusText || `HTTP ${res.status}`));
  }
  if (!text.trim()) return { success: true };
  return JSON.parse(text) as { success: boolean; message?: string };
}

/** `deploy` = build + up; `reload` = compose up --no-build / stack deploy; `redeploy` = stop + rebuild + up (compose) or stack deploy + forced service restart. */
export async function executeServiceDeploymentApi(
  id: string,
  mode: "deploy" | "reload" | "redeploy" = "deploy",
): Promise<{ success: boolean; output: string }> {
  const res = await apiFetch(`/api/services/${encodeURIComponent(id)}/execute`, {
    method: "POST",
    body: JSON.stringify({ mode }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(nestErrorMessage(text, res.statusText || `HTTP ${res.status}`));
  }
  const j = JSON.parse(text) as { success?: boolean; output?: string };
  return { success: j.success !== false, output: typeof j.output === "string" ? j.output : "" };
}

/** Uploads saved compose to the deploy host `/opt/weehawk-deployments/...` mirror without running docker (for on-host webhooks). */
export async function syncRemoteDeploymentMirrorApi(id: string): Promise<{ ok: boolean }> {
  const res = await apiFetch(
    `/api/services/${encodeURIComponent(id)}/sync-remote-deployment-mirror`,
    { method: "POST" },
  );
  const text = await res.text();
  if (!res.ok) {
    throw new Error(nestErrorMessage(text, res.statusText || `HTTP ${res.status}`));
  }
  return JSON.parse(text) as { ok: boolean };
}

/** SSE: same deploy as `POST .../execute` with streamed chunks (`{ data }`) then `{ done, success, output }`. */
export function serviceDeployStreamUrl(
  serviceId: string,
  mode: "deploy" | "reload" | "redeploy",
): string {
  return `${API_BASE}/api/services/${encodeURIComponent(serviceId)}/deploy/stream?mode=${encodeURIComponent(mode)}`;
}

function parseDeploySsePayload(raw: string): {
  chunk?: string;
  data?: string;
  done?: boolean;
  success?: boolean;
  output?: string;
} | null {
  const t = raw.trim();
  if (!t) return null;
  try {
    return JSON.parse(t) as {
      chunk?: string;
      data?: string;
      done?: boolean;
      success?: boolean;
      output?: string;
    };
  } catch {
    return null;
  }
}

/**
 * Streams deploy output (local `docker` or remote SSH) like container log streaming.
 */
export async function streamServiceDeploy(
  serviceId: string,
  mode: "deploy" | "reload" | "redeploy",
  onChunk: (text: string) => void,
  signal?: AbortSignal,
): Promise<{ success: boolean; output: string }> {
  const url = serviceDeployStreamUrl(serviceId, mode);
  let res: Response;
  try {
    res = await fetch(url, {
      method: "GET",
      headers: { Accept: "text/event-stream" },
      mode: "cors",
      credentials: typeof window !== "undefined" ? "include" : undefined,
      signal,
    });
  } catch (e) {
    throw new Error(e instanceof Error ? e.message : String(e));
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(nestErrorMessage(text, `HTTP ${res.status}`));
  }
  const reader = res.body?.getReader();
  if (!reader) {
    throw new Error("No response body from deploy stream.");
  }
  const decoder = new TextDecoder();
  let lineBuffer = "";
  let finalOut: { success: boolean; output: string } | null = null;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      lineBuffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = lineBuffer.indexOf("\n")) >= 0) {
        const line = lineBuffer.slice(0, nl);
        lineBuffer = lineBuffer.slice(nl + 1);
        const trimmed = line.replace(/\r$/, "");
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trimStart();
        if (!payload || payload === "[DONE]") continue;
        const parsed = parseDeploySsePayload(payload);
        if (!parsed) continue;
        if (parsed.done === true) {
          finalOut = {
            success: parsed.success !== false,
            output: typeof parsed.output === "string" ? parsed.output : "",
          };
          continue;
        }
        const piece =
          typeof parsed.data === "string"
            ? parsed.data
            : typeof parsed.chunk === "string"
              ? parsed.chunk
              : "";
        if (piece) onChunk(piece);
      }
    }
    if (lineBuffer.length) {
      const trimmed = lineBuffer.replace(/\r$/, "");
      if (trimmed.startsWith("data:")) {
        const payload = trimmed.slice(5).trimStart();
        const parsed = parseDeploySsePayload(payload);
        if (parsed?.done === true) {
          finalOut = {
            success: parsed.success !== false,
            output: typeof parsed.output === "string" ? parsed.output : "",
          };
        }
      }
    }
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw e instanceof Error ? e : new Error(String(e));
  }
  if (!finalOut) {
    throw new Error("Deploy stream ended without a result.");
  }
  return finalOut;
}

export async function runServiceBackupNowApi(
  id: string,
  body:
    | {
        action: "volume_backup";
        volumeSource: string;
        backupS3ProfileName: string;
      }
    | {
        action: "database_backup";
        databaseBackupConfig: DatabaseBackupConfig;
        backupS3ProfileName: string;
      },
): Promise<{ ok: boolean; action: "volume_backup" | "database_backup"; output: string }> {
  const res = await apiFetch(`/api/services/${encodeURIComponent(id)}/backup`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(nestErrorMessage(text, res.statusText || `HTTP ${res.status}`));
  }
  const j = JSON.parse(text) as { ok?: boolean; action?: string; output?: string };
  return {
    ok: j.ok === true,
    action: j.action as "volume_backup" | "database_backup",
    output: typeof j.output === "string" ? j.output : "",
  };
}

/** Multipart: `action`, `file`, plus `databaseBackupConfig` JSON string or `volumeSource`. */
export async function importServiceBackupApi(
  id: string,
  formData: FormData,
): Promise<{ ok: boolean; output: string }> {
  const res = await apiFetch(`/api/services/${encodeURIComponent(id)}/backup/import`, {
    method: "POST",
    body: formData,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(nestErrorMessage(text, res.statusText || `HTTP ${res.status}`));
  }
  const j = JSON.parse(text) as { ok?: boolean; output?: string };
  return { ok: j.ok === true, output: typeof j.output === "string" ? j.output : "" };
}

export async function importServiceBackupFromS3Api(
  id: string,
  body: {
    action: "import_database" | "import_volume";
    backupS3ProfileName: string;
    s3Key: string;
    databaseBackupConfig?: string;
    volumeSource?: string;
  },
): Promise<{ ok: boolean; output: string }> {
  const res = await apiFetch(`/api/services/${encodeURIComponent(id)}/backup/import-from-s3`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(nestErrorMessage(text, res.statusText || `HTTP ${res.status}`));
  }
  const j = JSON.parse(text) as { ok?: boolean; output?: string };
  return { ok: j.ok === true, output: typeof j.output === "string" ? j.output : "" };
}

export async function fetchServiceRuntime(id: string): Promise<{ running: boolean }> {
  const res = await apiFetch(`/api/services/${encodeURIComponent(id)}/runtime`);
  const text = await res.text();
  if (!res.ok) {
    throw new Error(nestErrorMessage(text, res.statusText || `HTTP ${res.status}`));
  }
  const j = JSON.parse(text) as { running?: boolean };
  return { running: j.running === true };
}

export interface ServiceVolumeMount {
  composeService: string;
  mountType: "bind" | "volume" | "tmpfs" | "unknown";
  source: string;
  target: string;
  readOnly: boolean;
  hostVolumeName?: string;
}

export interface ServiceVolumesResponse {
  items: ServiceVolumeMount[];
  error?: string;
}

/** Declared mounts from the service compose file (`docker compose config` on the API host). */
export async function fetchServiceVolumesApi(id: string): Promise<ServiceVolumesResponse> {
  const res = await apiFetch(`/api/services/${encodeURIComponent(id)}/volumes`);
  const text = await res.text();
  if (!res.ok) {
    throw new Error(nestErrorMessage(text, res.statusText || `HTTP ${res.status}`));
  }
  const j = JSON.parse(text) as ServiceVolumesResponse;
  const items = Array.isArray(j.items) ? j.items : [];
  return {
    items,
    error: typeof j.error === "string" ? j.error : undefined,
  };
}

export async function startServiceApi(id: string): Promise<{ success: boolean; output?: string }> {
  const res = await apiFetch(`/api/services/${encodeURIComponent(id)}/start`, { method: "POST" });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(nestErrorMessage(text, res.statusText || `HTTP ${res.status}`));
  }
  if (!text.trim()) return { success: true };
  return JSON.parse(text) as { success: boolean; output?: string };
}

/** Deploy-host mirror result after generating application stack (compose + app-source on server). */
export type RemoteMirrorPayload =
  | { status: "synced" }
  | { status: "skipped"; reason: "no_deploy_host" }
  | { status: "failed"; message: string };

function parseRemoteMirrorPayload(raw: unknown): RemoteMirrorPayload | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  const st = o.status;
  if (st === "synced") return { status: "synced" };
  if (st === "skipped" && o.reason === "no_deploy_host") {
    return { status: "skipped", reason: "no_deploy_host" };
  }
  if (st === "failed" && typeof o.message === "string") {
    return { status: "failed", message: o.message };
  }
  return undefined;
}

/** Stage: resolve Git ref and persist binding (no app files on API). Then call `generateApplicationFromSourceApi`. */
export async function applicationGitCloneStageApi(
  id: string,
  options: {
    gitlabProjectId?: number;
    githubInstallationId?: number;
    githubRepoFullName?: string;
    httpUrlToRepo?: string;
    branch?: string;
  },
): Promise<Service> {
  const body: Record<string, unknown> = {};
  if (options.gitlabProjectId != null) body.gitlabProjectId = options.gitlabProjectId;
  if (options.githubInstallationId != null) body.githubInstallationId = options.githubInstallationId;
  if (options.githubRepoFullName?.trim()) body.githubRepoFullName = options.githubRepoFullName.trim();
  if (options.httpUrlToRepo?.trim()) body.httpUrlToRepo = options.httpUrlToRepo.trim();
  if (options.branch?.trim()) body.branch = options.branch.trim();
  const res = await apiFetch(`/api/services/${encodeURIComponent(id)}/application/git-clone-stage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(nestErrorMessage(text, res.statusText || `HTTP ${res.status}`));
  }
  const json = JSON.parse(text) as { service?: unknown };
  if (!json.service) throw new Error("Request succeeded but no service payload was returned.");
  return mapApiServiceToService(json.service);
}

/** Generate stack from existing app-source (after git-clone-stage or re-apply options). */
export async function generateApplicationFromSourceApi(
  id: string,
  options: {
    buildPath?: string;
    dockerfilePath?: string;
    containerPort?: number;
    publishPort?: number;
    replicas?: number;
    variables?: Array<{ key: string; value: string }>;
    networks?: { external: string[]; stack: string[] };
  },
): Promise<{ service: Service; remoteMirror?: RemoteMirrorPayload }> {
  const body: Record<string, unknown> = {
    buildPath: options.buildPath,
    dockerfilePath: options.dockerfilePath,
    containerPort: options.containerPort,
    publishPort: options.publishPort,
    replicas: options.replicas,
  };
  if (options.variables !== undefined) {
    body.variablesJson = JSON.stringify(options.variables);
  }
  if (options.networks) {
    const { external, stack } = options.networks;
    body.externalNetworks = external.join("|");
    body.stackNetworks = stack.join("|");
    body.networksJson = JSON.stringify(options.networks);
  }
  const res = await apiFetch(`/api/services/${encodeURIComponent(id)}/application/generate-from-source`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(nestErrorMessage(text, res.statusText || `HTTP ${res.status}`));
  }
  const json = JSON.parse(text) as { service?: unknown; remoteMirror?: unknown };
  if (!json.service) throw new Error("Request succeeded but no service payload was returned.");
  return {
    service: mapApiServiceToService(json.service),
    remoteMirror: parseRemoteMirrorPayload(json.remoteMirror),
  };
}

/** @deprecated One-shot clone + stack; prefer `applicationGitCloneStageApi` + `generateApplicationFromSourceApi`. */
export async function uploadApplicationGitCloneApi(
  id: string,
  options: {
    gitlabProjectId?: number;
    httpUrlToRepo?: string;
    branch?: string;
    buildPath?: string;
    containerPort?: number;
    publishPort?: number;
    replicas?: number;
    variables?: Array<{ key: string; value: string }>;
    networks?: { external: string[]; stack: string[] };
  },
): Promise<{ service: Service; remoteMirror?: RemoteMirrorPayload }> {
  const body: Record<string, unknown> = {
    buildPath: options.buildPath,
    containerPort: options.containerPort,
    publishPort: options.publishPort,
    replicas: options.replicas,
  };
  if (options.gitlabProjectId != null) body.gitlabProjectId = options.gitlabProjectId;
  if (options.httpUrlToRepo?.trim()) body.httpUrlToRepo = options.httpUrlToRepo.trim();
  if (options.branch?.trim()) body.branch = options.branch.trim();
  if (options.variables !== undefined) {
    body.variablesJson = JSON.stringify(options.variables);
  }
  if (options.networks) {
    const { external, stack } = options.networks;
    body.externalNetworks = external.join("|");
    body.stackNetworks = stack.join("|");
    body.networksJson = JSON.stringify(options.networks);
  }
  const res = await apiFetch(`/api/services/${encodeURIComponent(id)}/application/git-clone`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(nestErrorMessage(text, res.statusText || `HTTP ${res.status}`));
  }
  const json = JSON.parse(text) as { service?: unknown; remoteMirror?: unknown };
  if (!json.service) throw new Error("Request succeeded but no service payload was returned.");
  return {
    service: mapApiServiceToService(json.service),
    remoteMirror: parseRemoteMirrorPayload(json.remoteMirror),
  };
}

/** Configure Swarm stack to use a pre-built image (no ZIP upload / docker build on deploy). */
export async function patchApplicationImageDeployApi(
  id: string,
  options: {
    imageRef: string;
    containerPort?: number;
    publishPort?: number;
    replicas?: number;
    variables?: Array<{ key: string; value: string }>;
    networks?: { external: string[]; stack: string[] };
  },
): Promise<Service> {
  const body: Record<string, unknown> = {
    imageRef: options.imageRef.trim(),
    containerPort: options.containerPort,
    publishPort: options.publishPort,
    replicas: options.replicas,
  };
  if (options.variables !== undefined) {
    body.variablesJson = JSON.stringify(options.variables);
  }
  if (options.networks) {
    const { external, stack } = options.networks;
    body.externalNetworks = external.join("|");
    body.stackNetworks = stack.join("|");
    body.networksJson = JSON.stringify(options.networks);
  }
  const res = await apiFetch(`/api/services/${encodeURIComponent(id)}/application/image`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(nestErrorMessage(text, res.statusText || `HTTP ${res.status}`));
  }
  const json = JSON.parse(text) as { service?: unknown };
  if (!json.service) throw new Error("Request succeeded but no service payload was returned.");
  return mapApiServiceToService(json.service);
}

/** SSE endpoint: `GET /api/services/:id/logs/stream` (see `ServicesController.streamLogs`). */
export function serviceLogsStreamUrl(serviceId: string): string {
  return `${API_BASE}/api/services/${encodeURIComponent(serviceId)}/logs/stream`;
}

function parseSseDataLine(line: string): string | null {
  const trimmed = line.replace(/\r$/, "");
  if (!trimmed.startsWith("data:")) return null;
  const payload = trimmed.slice(5).trimStart();
  if (!payload || payload === "[DONE]") return null;
  return parseServiceLogsSseData(payload);
}

/**
 * Reads the logs SSE stream with `fetch` (so HTTP errors and response bodies are visible).
 * Prefer over `EventSource`, which hides failed responses and auth details.
 */
export async function streamServiceLogs(
  serviceId: string,
  onChunk: (text: string) => void,
  onError: (message: string) => void,
  signal: AbortSignal,
): Promise<void> {
  const url = serviceLogsStreamUrl(serviceId);
  let res: Response;
  try {
    res = await fetch(url, {
      method: "GET",
      headers: { Accept: "text/event-stream" },
      mode: "cors",
      credentials: typeof window !== "undefined" ? "include" : undefined,
      signal,
    });
  } catch (e) {
    onError(e instanceof Error ? e.message : String(e));
    return;
  }
  if (!res.ok) {
    const text = await res.text();
    onError(nestErrorMessage(text, `HTTP ${res.status}`));
    return;
  }
  const reader = res.body?.getReader();
  if (!reader) {
    onError("No response body from log stream.");
    return;
  }
  const decoder = new TextDecoder();
  let lineBuffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      lineBuffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = lineBuffer.indexOf("\n")) >= 0) {
        const line = lineBuffer.slice(0, nl);
        lineBuffer = lineBuffer.slice(nl + 1);
        const chunk = parseSseDataLine(line);
        if (chunk) onChunk(chunk);
      }
    }
    if (lineBuffer.length) {
      const chunk = parseSseDataLine(lineBuffer);
      if (chunk) onChunk(chunk);
    }
  } catch (e) {
    if ((e as Error).name === "AbortError") return;
    onError(e instanceof Error ? e.message : String(e));
  }
}

/** WebSocket: `GET /ws/service-terminal?serviceId=` — interactive `docker exec` stream. */
export function serviceTerminalWsUrl(serviceId: string): string {
  return `${wsBase()}/ws/service-terminal?serviceId=${encodeURIComponent(serviceId)}`;
}

export function serviceTerminalWsUrlCandidates(serviceId: string): string[] {
  const sid = encodeURIComponent(serviceId);
  return wsBaseCandidates().map((base) => `${base}/ws/service-terminal?serviceId=${sid}`);
}

/** Unwrap NestJS SSE payload from `EventSource` `message` data. */
export function parseServiceLogsSseData(raw: string): string {
  const t = raw.trim();
  if (!t) return "";
  try {
    const j = JSON.parse(raw) as { data?: unknown };
    if (typeof j.data === "string") return j.data;
    if (j.data != null && typeof j.data !== "object") return String(j.data);
  } catch {
    /* plain text chunk */
  }
  return raw;
}

// ─── Auto-deploy ──────────────────────────────────────────────────────────────

export type AutoDeploySettings = {
  autoDeployEnabled: boolean;
  autoDeployBranch: string;
  autoDeployGitProvider: string | null;
  autoDeployRepoId: string | null;
};

export async function fetchAutoDeploySettings(
  serviceId: string,
): Promise<AutoDeploySettings> {
  const res = await apiFetch(
    `/api/services/${encodeURIComponent(serviceId)}/auto-deploy`,
  );
  const text = await res.text();
  if (!res.ok)
    throw new Error(nestErrorMessage(text, res.statusText || `HTTP ${res.status}`));
  return JSON.parse(text) as AutoDeploySettings;
}

export async function configureAutoDeployApi(
  serviceId: string,
  body: {
    enabled: boolean;
    branch?: string;
    gitProvider?: string | null;
    repoId?: string | null;
  },
): Promise<AutoDeploySettings> {
  const res = await apiFetch(
    `/api/services/${encodeURIComponent(serviceId)}/auto-deploy`,
    { method: "POST", body: JSON.stringify(body) },
  );
  const text = await res.text();
  if (!res.ok)
    throw new Error(nestErrorMessage(text, res.statusText || `HTTP ${res.status}`));
  return JSON.parse(text) as AutoDeploySettings;
}

/**
 * Re-register auto-deploy hooks on GitHub/GitLab after the local webhook URL changes
 * (e.g. after a token regenerate).
 */
export async function resyncAutoDeployHooks(
  serviceId: string,
): Promise<{ updated: boolean }> {
  const res = await apiFetch(
    `/api/services/${encodeURIComponent(serviceId)}/auto-deploy/resync`,
    { method: "POST" },
  );
  const text = await res.text();
  if (!res.ok)
    throw new Error(nestErrorMessage(text, res.statusText || `HTTP ${res.status}`));
  return JSON.parse(text) as { updated: boolean };
}
