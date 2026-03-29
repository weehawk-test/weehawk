import { API_BASE } from "./api";

/** Hint under error banners on Docker pages */
export const DOCKER_API_HELP =
  "The API runs docker on the server host: start Docker Desktop (Windows/macOS) or the docker service (Linux). Set NEXT_PUBLIC_API_URL if the API is not at http://localhost:8080.";

function pickStr(row: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    const v = row[k];
    if (v !== undefined && v !== null && String(v).length > 0) return String(v);
  }
  return "";
}

export type ContainerStatus = "running" | "stopped" | "exited";

export interface DockerContainer {
  id: string;
  name: string;
  image: string;
  status: ContainerStatus;
  ports: string;
  createdAt: string;
}

export interface DockerImage {
  id: string;
  repository: string;
  tag: string;
  /** Short ID for display (first 12 hex chars). */
  imageId: string;
  /** Full digest from Docker (`sha256:…` when available). Used for force-delete by ID. */
  imageIdFull: string;
  size: string;
  createdAt: string;
}

export interface DockerVolume {
  id: string;
  name: string;
  size: string;
  createdAt: string;
}

/** Row from `docker network ls --no-trunc --format "{{json .}}"` (mapped on the API). */
export interface DockerNetwork {
  id: string;
  networkIdShort: string;
  name: string;
  driver: string;
  scope: string;
  internal: boolean;
  ipv6: boolean;
  createdAt: string;
}

function mapContainerStatus(status: string): ContainerStatus {
  const s = status.toLowerCase();
  if (s.startsWith("up") || s.includes("running")) return "running";
  if (s.startsWith("exited") || s.includes("dead")) return "exited";
  return "stopped";
}

function normalizeName(names: string): string {
  const n = names.split(",")[0]?.trim() ?? "";
  return n.replace(/^\//, "") || "—";
}

export function mapDockerPsRow(row: Record<string, unknown>, index: number): DockerContainer {
  const status = pickStr(row, "Status", "State");
  const names = pickStr(row, "Names");
  const created = pickStr(row, "CreatedAt", "RunningFor");
  const fullId = pickStr(row, "ID", "Id");
  return {
    id: fullId || `container-${index}`,
    name: normalizeName(names),
    image: pickStr(row, "Image") || "—",
    status: mapContainerStatus(status || "unknown"),
    ports: pickStr(row, "Ports") || "—",
    createdAt: created || new Date().toISOString(),
  };
}

function normalizeImageIdFull(raw: string): string {
  const t = raw.trim();
  if (!t) return "";
  if (/^sha256:[a-f0-9]{64}$/i.test(t)) return `sha256:${t.slice(7).toLowerCase()}`;
  if (/^[a-f0-9]{64}$/i.test(t)) return `sha256:${t.toLowerCase()}`;
  return t;
}

function shortImageIdForDisplay(full: string): string {
  if (!full) return "—";
  if (/^sha256:/i.test(full)) return full.slice(7, 19);
  return full.slice(0, 12);
}

export function mapDockerImageRow(row: Record<string, unknown>, index: number): DockerImage {
  const repo = pickStr(row, "Repository");
  const tag = pickStr(row, "Tag") || "latest";
  const idRaw = pickStr(row, "ID", "Id");
  const imageIdFull = normalizeImageIdFull(idRaw);
  // IMAGE ID repeats when one digest has many repo:tag lines; key rows by index too.
  return {
    id: `${repo}:${tag}:${index}`,
    repository: repo || "<none>",
    tag,
    imageId: shortImageIdForDisplay(imageIdFull || idRaw) || "—",
    imageIdFull: imageIdFull || idRaw.trim(),
    size: pickStr(row, "Size") || "—",
    createdAt: pickStr(row, "CreatedAt", "CreatedSince") || new Date().toISOString(),
  };
}

function normalizeVolumeCreatedAt(raw: string): string {
  if (!raw.trim()) return new Date().toISOString();
  const ms = Date.parse(raw);
  if (!Number.isNaN(ms)) return new Date(ms).toISOString();
  return raw;
}

export function mapDockerVolumeRow(row: Record<string, unknown>, index: number): DockerVolume {
  const name = pickStr(row, "Name");
  const sizeRaw = pickStr(row, "Size");
  const size =
    sizeRaw && !/^N\/A$/i.test(sizeRaw.trim()) ? sizeRaw.trim() : "—";
  const createdRaw = pickStr(row, "CreatedAt", "Created");
  return {
    id: name || `vol-${index}`,
    name: name || "—",
    size,
    createdAt: normalizeVolumeCreatedAt(createdRaw),
  };
}

async function fetchJson(path: string): Promise<unknown> {
  const res = await fetch(`${API_BASE}${path}`, { cache: "no-store" });
  const text = await res.text();
  if (!res.ok) {
    let msg = text || res.statusText || `HTTP ${res.status}`;
    try {
      const j = JSON.parse(text) as { message?: string | string[] };
      if (typeof j.message === "string") msg = j.message;
      else if (Array.isArray(j.message)) msg = j.message.join(", ");
    } catch {
      /* keep raw text */
    }
    throw new Error(msg);
  }
  return text ? JSON.parse(text) : [];
}

export async function fetchDockerContainers(): Promise<DockerContainer[]> {
  const raw = await fetchJson("/docker-monitor/containers");
  if (!Array.isArray(raw)) return [];
  return raw.map((item, i) => mapDockerPsRow(item as Record<string, unknown>, i));
}

export async function fetchDockerImages(): Promise<DockerImage[]> {
  const raw = await fetchJson("/docker-monitor/images");
  if (!Array.isArray(raw)) return [];
  return raw.map((item, i) => mapDockerImageRow(item as Record<string, unknown>, i));
}

export async function fetchDockerVolumes(): Promise<DockerVolume[]> {
  const raw = await fetchJson("/docker-monitor/volumes");
  if (!Array.isArray(raw)) return [];
  return raw.map((item, i) => mapDockerVolumeRow(item as Record<string, unknown>, i));
}

/** One snapshot row from `docker stats --no-stream` */
export interface DockerContainerStats {
  containerId: string;
  name: string;
  cpuPercent: number;
  memoryUsedMiB: number;
  memoryLimitMiB: number;
  netIoIn: string;
  netIoOut: string;
}

function parseSizeToMiB(s: string): number {
  const t = s.trim();
  const m = t.match(/^([\d.]+)\s*([a-zA-Z]+)?/);
  if (!m) return 0;
  const n = parseFloat(m[1]);
  const u = (m[2] || "b").toLowerCase();
  if (u === "b" || u === "byte" || u === "bytes") return n / 1024 / 1024;
  if (u === "kb" || u === "kib") return n / 1024;
  if (u === "mb" || u === "mib") return n;
  if (u === "gb" || u === "gib") return n * 1024;
  if (u === "tb" || u === "tib") return n * 1024 * 1024;
  return n;
}

function parseMemUsageMiB(memUsage: string): { used: number; limit: number } {
  const parts = memUsage.split("/").map((x) => x.trim());
  if (parts.length < 2) return { used: 0, limit: 512 };
  return {
    used: parseSizeToMiB(parts[0]),
    limit: Math.max(parseSizeToMiB(parts[1]), 1),
  };
}

function splitNetIO(netIO: string): { in: string; out: string } {
  const parts = netIO.split("/").map((x) => x.trim());
  return { in: parts[0] || "—", out: parts[1] || "—" };
}

export function mapDockerStatsRow(row: Record<string, unknown>): DockerContainerStats {
  const rawId = pickStr(row, "ID", "Id");
  const id = rawId.replace(/^sha256:/i, "").slice(0, 12);
  const name = pickStr(row, "Name", "Container");
  const cpuStr = pickStr(row, "CPUPerc", "CPUPercent");
  const cpuPercent = parseFloat(String(cpuStr).replace("%", "").replace(",", ".")) || 0;
  const memUsage = pickStr(row, "MemUsage");
  const { used, limit } = parseMemUsageMiB(memUsage || "0 / 512MiB");
  const netIO = pickStr(row, "NetIO");
  const { in: netIn, out: netOut } = splitNetIO(netIO || " / ");
  return {
    containerId: id,
    name,
    cpuPercent,
    memoryUsedMiB: used,
    memoryLimitMiB: limit,
    netIoIn: netIn,
    netIoOut: netOut,
  };
}

export async function fetchDockerStats(): Promise<DockerContainerStats[]> {
  const raw = await fetchJson("/docker-monitor/stats");
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => mapDockerStatsRow(item as Record<string, unknown>));
}

export function findStatsForContainer(
  container: DockerContainer,
  stats: DockerContainerStats[],
): DockerContainerStats | undefined {
  const idNorm = container.id.replace(/^sha256:/i, "").slice(0, 12);
  const nameNorm = (n: string) => n.replace(/^\//, "").trim();
  return stats.find((s) => {
    if (idNorm && s.containerId && s.containerId === idNorm) return true;
    if (s.name && nameNorm(s.name) === nameNorm(container.name)) return true;
    return false;
  });
}

async function dockerDelete(path: string): Promise<void> {
  const res = await fetch(`${API_BASE}${path}`, { method: "DELETE", cache: "no-store" });
  const text = await res.text();

  let parsed: { success?: boolean; statusCode?: number; message?: string | string[] } | null = null;
  if (text) {
    try {
      parsed = JSON.parse(text) as { success?: boolean; statusCode?: number; message?: string | string[] };
    } catch {
      parsed = null;
    }
  }

  const messageFromParsed = (): string | null => {
    if (!parsed) return null;
    const m = parsed.message;
    if (typeof m === "string") return m;
    if (Array.isArray(m)) return m.join(", ");
    return null;
  };

  if (!res.ok) {
    throw new Error(
      messageFromParsed() ?? (text.trim() || res.statusText || `HTTP ${res.status}`),
    );
  }

  if (parsed && parsed.success === false) {
    throw new Error(messageFromParsed() ?? "Delete failed");
  }
  if (parsed && typeof parsed.statusCode === "number" && parsed.statusCode >= 400) {
    throw new Error(messageFromParsed() ?? `Error ${parsed.statusCode}`);
  }
}

/** Reference string for `docker rmi` (repo:tag, or id for dangling images). */
export function dockerImageDeleteRef(img: DockerImage): string {
  if (img.repository === "<none>" || img.tag === "<none>") {
    const raw = img.imageIdFull || img.imageId;
    return raw.replace(/^sha256:/i, "");
  }
  return `${img.repository}:${img.tag}`;
}

/**
 * Reference for `docker rmi -f` by image digest (full `sha256:…` when available).
 * Matches: `docker rmi -f sha256:8b81dd37ff…`
 */
export function dockerImageForceDeleteRef(img: DockerImage): string {
  const raw = (img.imageIdFull || img.imageId).trim();
  if (!raw || raw === "—") return dockerImageDeleteRef(img);
  if (/^sha256:/i.test(raw)) return raw;
  if (/^[a-f0-9]{64}$/i.test(raw)) return `sha256:${raw}`;
  return raw;
}

export async function deleteDockerContainer(idOrName: string): Promise<void> {
  await dockerDelete(`/docker-monitor/containers/${encodeURIComponent(idOrName)}`);
}

export async function fetchDockerContainerLogs(
  idOrName: string,
  tail = 500,
): Promise<string> {
  const q = new URLSearchParams({ tail: String(tail) });
  const res = await fetch(
    `${API_BASE}/docker-monitor/containers/${encodeURIComponent(idOrName)}/logs?${q}`,
    { cache: "no-store" },
  );
  const text = await res.text();
  if (!res.ok) {
    let msg = text || res.statusText || `HTTP ${res.status}`;
    try {
      const j = JSON.parse(text) as { message?: string | string[] };
      if (typeof j.message === "string") msg = j.message;
      else if (Array.isArray(j.message)) msg = j.message.join(", ");
    } catch {
      /* keep raw */
    }
    throw new Error(msg);
  }
  const j = JSON.parse(text) as { logs?: string };
  return j.logs ?? "";
}

export async function deleteDockerImage(ref: string): Promise<void> {
  await dockerDelete(`/docker-monitor/images?ref=${encodeURIComponent(ref)}`);
}

export async function deleteDockerVolume(name: string): Promise<void> {
  await dockerDelete(`/docker-monitor/volumes/${encodeURIComponent(name)}`);
}

export async function deleteDockerNetwork(nameOrId: string): Promise<void> {
  await dockerDelete(`/docker-monitor/networks/${encodeURIComponent(nameOrId)}`);
}
