import { API_BASE } from "./api";
import type { CreateServiceInput, Service, ServiceType } from "./schema";
import type { DatabaseEngineId } from "./database-engines";
import { getServerApiBase } from "./server-api";

function nestErrorMessage(text: string, fallback: string): string {
  try {
    const j = JSON.parse(text) as { message?: string | string[] };
    if (typeof j.message === "string") return j.message;
    if (Array.isArray(j.message)) return j.message.join(", ");
  } catch {
    /* keep fallback */
  }
  return text.trim() || fallback;
}

async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const base = typeof window === "undefined" ? getServerApiBase() : API_BASE;
  const headers: HeadersInit = {
    Accept: "application/json",
    ...(init?.body ? { "Content-Type": "application/json" } : {}),
    ...init?.headers,
  };
  return fetch(`${base}${path}`, { ...init, cache: "no-store", headers });
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

function composeTypeToApi(t: ServiceType): "COMPOSE" | "STACK" | "DATABASES" {
  if (t === "stack") return "STACK";
  if (t === "databases") return "DATABASES";
  return "COMPOSE";
}

function composeTypeFromApi(raw: string): ServiceType {
  const u = String(raw).toUpperCase();
  if (u === "STACK") return "stack";
  if (u === "DATABASES") return "databases";
  return "docker-compose";
}

export function mapApiServiceToService(row: unknown): Service {
  const s = row as Record<string, unknown>;
  const project = s.project as { id?: number } | undefined;
  const pid = project?.id;
  const created = s.createdAt;
  let createdAt: string;
  if (created instanceof Date) createdAt = created.toISOString();
  else if (typeof created === "string") createdAt = created;
  else createdAt = new Date().toISOString();

  const ld = s.lastDeployedAt;
  let lastDeployedAt: string | null = null;
  if (ld instanceof Date) lastDeployedAt = ld.toISOString();
  else if (typeof ld === "string" && ld.length) lastDeployedAt = ld;

  return {
    id: String(s.id ?? ""),
    projectId: pid != null ? String(pid) : "",
    name: String(s.name ?? ""),
    type: composeTypeFromApi(String(s.composeType ?? "COMPOSE")),
    config: typeof s.dockerConfig === "string" ? s.dockerConfig : "",
    env: typeof s.env === "string" ? s.env : "",
    description: typeof s.description === "string" ? s.description : "",
    domains: Array.isArray(s.domains) ? (s.domains as string[]).filter((x) => typeof x === "string") : [],
    createdAt,
    isActive: s.isActive !== false,
    lastDeployedAt,
    appName: typeof s.appName === "string" ? s.appName : undefined,
  };
}

export async function fetchServices(projectId?: string): Promise<Service[]> {
  const q = projectId ? `?projectId=${encodeURIComponent(projectId)}` : "";
  const res = await apiFetch(`/services${q}`);
  const text = await res.text();
  if (!res.ok) {
    throw new Error(nestErrorMessage(text, res.statusText || `HTTP ${res.status}`));
  }
  const data = JSON.parse(text) as unknown;
  if (!Array.isArray(data)) return [];
  return data.map(mapApiServiceToService);
}

export async function fetchService(id: string): Promise<Service> {
  const res = await apiFetch(`/services/${encodeURIComponent(id)}`);
  const text = await res.text();
  if (!res.ok) {
    throw new Error(nestErrorMessage(text, res.statusText || `HTTP ${res.status}`));
  }
  return mapApiServiceToService(JSON.parse(text));
}

export async function createServiceApi(input: CreateServiceInput): Promise<Service> {
  const { databaseEngine, postgres: _postgres, ...rest } = input;
  let dockerConfig = rest.config?.trim() ? rest.config : "";
  if (rest.type === "databases" && databaseEngine) {
    dockerConfig = `# weehawk database service\n# engine: ${databaseEngine}\n`;
  }
  const body = {
    name: rest.name,
    appName: deriveAppNameFromServiceName(rest.name),
    composeType: composeTypeToApi(rest.type),
    description: rest.description?.trim() || undefined,
    dockerConfig,
    projectId: Number(rest.projectId),
  };
  const res = await apiFetch("/services", {
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
    storeDbName?: "env" | "secret";
    storeUser?: "env" | "secret";
    storePass?: "env" | "secret";
    storeRootUser?: "env" | "secret";
    storeRootPass?: "env" | "secret";
    storePassword?: "env" | "secret";
    volumePath?: string;
    replicas?: number;
    publishPort?: number;
    image?: string;
  },
): Promise<Service> {
  const res = await apiFetch(`/services/${encodeURIComponent(id)}/database/postgres`, {
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
    storeDbName?: "env" | "secret";
    storeUser?: "env" | "secret";
    storePass?: "env" | "secret";
    storeRootUser?: "env" | "secret";
    storeRootPass?: "env" | "secret";
    storePassword?: "env" | "secret";
    volumePath?: string;
    replicas?: number;
    publishPort?: number;
    image?: string;
  },
): Promise<Service> {
  const res = await apiFetch(`/services/${encodeURIComponent(id)}/database/${encodeURIComponent(engine)}`, {
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
  const res = await apiFetch(`/services/${encodeURIComponent(id)}/database/postgres/stack`, {
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
  const res = await apiFetch(`/services/${encodeURIComponent(id)}/database/${encodeURIComponent(engine)}/stack`, {
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
  patch: Partial<Pick<Service, "config" | "env" | "isActive" | "description" | "domains">>,
): Promise<Service> {
  const body: Record<string, unknown> = {};
  if (patch.config !== undefined) body.dockerConfig = patch.config;
  if (patch.env !== undefined) body.env = patch.env;
  if (patch.isActive !== undefined) body.isActive = patch.isActive;
  if (patch.description !== undefined) body.description = patch.description;
  if (patch.domains !== undefined) body.domains = patch.domains;

  const res = await apiFetch(`/services/${encodeURIComponent(id)}`, {
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
  const res = await apiFetch(`/services/${encodeURIComponent(id)}`, { method: "DELETE" });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(nestErrorMessage(text, res.statusText || `HTTP ${res.status}`));
  }
}

/** Stops containers/stack without deleting the service (see ExecutorService.shutdown). */
export async function shutdownServiceApi(id: string): Promise<{ success: boolean; message?: string }> {
  const res = await apiFetch(`/services/${encodeURIComponent(id)}/shutdown`, { method: "POST" });
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
  const res = await apiFetch(`/services/${encodeURIComponent(id)}/execute`, {
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

export async function fetchServiceRuntime(id: string): Promise<{ running: boolean }> {
  const res = await apiFetch(`/services/${encodeURIComponent(id)}/runtime`);
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
  const res = await apiFetch(`/services/${encodeURIComponent(id)}/volumes`);
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
  const res = await apiFetch(`/services/${encodeURIComponent(id)}/start`, { method: "POST" });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(nestErrorMessage(text, res.statusText || `HTTP ${res.status}`));
  }
  if (!text.trim()) return { success: true };
  return JSON.parse(text) as { success: boolean; output?: string };
}

/** SSE endpoint: `GET /services/:id/logs/stream` (see `ServicesController.streamLogs`). */
export function serviceLogsStreamUrl(serviceId: string): string {
  return `${API_BASE}/services/${encodeURIComponent(serviceId)}/logs/stream`;
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
  const wsBase = API_BASE.replace(/^http:/i, "ws:").replace(/^https:/i, "wss:");
  return `${wsBase}/ws/service-terminal?serviceId=${encodeURIComponent(serviceId)}`;
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
