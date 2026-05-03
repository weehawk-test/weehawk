import { API_BASE, wsBase, wsBaseCandidates } from "./api";
import { authFetch } from "./auth-fetch";

export type RemoteServerAuthMode = "stored" | "none";

export type RemoteServerRole = "deploy" | "build";

export type RemoteServerRow = {
  id: number;
  publicId?: string;
  name: string;
  host: string;
  port: number;
  sshUser: string;
  serverRole: RemoteServerRole;
  authMode: RemoteServerAuthMode;
  hasPrivateKey: boolean;
  /** Public IPv4 for Magic traefik.me hostnames on deployed services. */
  publicIpv4: string | null;
  /** JSON string: domain labels / metadata (Domains page; deploy servers). */
  domainsJson: string | null;
  createdAt: string;
  updatedAt: string;
};

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

export async function fetchRemoteServers(
  accessToken: string,
  organizationPublicId?: string | null,
): Promise<RemoteServerRow[]> {
  const q =
    organizationPublicId != null && String(organizationPublicId).trim() !== ""
      ? `?organizationPublicId=${encodeURIComponent(String(organizationPublicId).trim())}`
      : "";
  const res = await authFetch(accessToken, `${API_BASE}/api/remote-servers${q}`, {
    method: "GET",
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(nestErrorMessage(text, res.statusText || `HTTP ${res.status}`));
  }
  const data = JSON.parse(text) as unknown;
  if (!Array.isArray(data)) return [];
  return data.map((row) => mapRemoteServer(row));
}

function mapRemoteServer(row: unknown): RemoteServerRow {
  const r = row as Record<string, unknown>;
  const ca = r.createdAt;
  const ua = r.updatedAt;
  const am = r.authMode;
  const authMode: RemoteServerAuthMode = am === "stored" || am === "none" ? am : "none";
  const sr = r.serverRole;
  const serverRole: RemoteServerRole = sr === "build" ? "build" : "deploy";
  return {
    id: typeof r.id === "number" ? r.id : Number(r.id),
    publicId:
      r.publicId == null || String(r.publicId).trim() === ""
        ? undefined
        : String(r.publicId),
    name: String(r.name ?? ""),
    host: String(r.host ?? ""),
    port: typeof r.port === "number" ? r.port : 22,
    sshUser: String(r.sshUser ?? ""),
    serverRole,
    authMode,
    hasPrivateKey: r.hasPrivateKey === true,
    publicIpv4:
      r.publicIpv4 === null || r.publicIpv4 === undefined
        ? null
        : String(r.publicIpv4),
    domainsJson:
      r.domainsJson === null || r.domainsJson === undefined || r.domainsJson === ""
        ? null
        : String(r.domainsJson),
    createdAt:
      ca instanceof Date ? ca.toISOString() : typeof ca === "string" ? ca : new Date().toISOString(),
    updatedAt:
      ua instanceof Date ? ua.toISOString() : typeof ua === "string" ? ua : new Date().toISOString(),
  };
}

export async function generateRemoteSshKeypairApi(
  accessToken: string,
): Promise<{ privateKey: string; publicKey: string }> {
  const res = await authFetch(accessToken, `${API_BASE}/api/remote-servers/generate-keypair`, {
    method: "POST",
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(nestErrorMessage(text, res.statusText || `HTTP ${res.status}`));
  }
  const j = JSON.parse(text) as { privateKey?: string; publicKey?: string };
  if (typeof j.privateKey !== "string" || typeof j.publicKey !== "string") {
    throw new Error("Invalid generate-keypair response");
  }
  return { privateKey: j.privateKey, publicKey: j.publicKey };
}

export async function createRemoteServerApi(
  accessToken: string,
  body: {
    name: string;
    host: string;
    port?: number;
    sshUser: string;
    privateKey: string;
    serverRole?: RemoteServerRole;
    publicIpv4?: string;
    domainsJson?: string;
    organizationPublicId?: string;
  },
): Promise<RemoteServerRow> {
  const res = await authFetch(accessToken, `${API_BASE}/api/remote-servers`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(nestErrorMessage(text, res.statusText || `HTTP ${res.status}`));
  }
  return mapRemoteServer(JSON.parse(text));
}

export async function updateRemoteServerApi(
  accessToken: string,
  id: string | number,
  patch: Partial<{
    name: string;
    host: string;
    port: number;
    sshUser: string;
    privateKey: string;
    serverRole: RemoteServerRole;
    publicIpv4: string | null;
    domainsJson?: string | null;
  }>,
): Promise<RemoteServerRow> {
  const res = await authFetch(accessToken, `${API_BASE}/api/remote-servers/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(nestErrorMessage(text, res.statusText || `HTTP ${res.status}`));
  }
  return mapRemoteServer(JSON.parse(text));
}

export async function deleteRemoteServerApi(accessToken: string, id: string | number): Promise<void> {
  const res = await authFetch(accessToken, `${API_BASE}/api/remote-servers/${id}`, {
    method: "DELETE",
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(nestErrorMessage(text, res.statusText || `HTTP ${res.status}`));
  }
}

export async function testRemoteServerApi(
  accessToken: string,
  id: string | number,
): Promise<{ success: boolean; output: string }> {
  const res = await authFetch(accessToken, `${API_BASE}/api/remote-servers/${id}/test`, {
    method: "POST",
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(nestErrorMessage(text, res.statusText || `HTTP ${res.status}`));
  }
  return JSON.parse(text) as { success: boolean; output: string };
}

/** SSH only (ssh2 + shell); does not call remote Docker API. */
export async function testRemoteServerSshApi(
  accessToken: string,
  id: string | number,
): Promise<{ success: boolean; output: string }> {
  const res = await authFetch(accessToken, `${API_BASE}/api/remote-servers/${id}/test-ssh`, {
    method: "POST",
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(nestErrorMessage(text, res.statusText || `HTTP ${res.status}`));
  }
  return JSON.parse(text) as { success: boolean; output: string };
}

export async function runRemoteServerTerminalCommandApi(
  accessToken: string,
  id: string | number,
  command: string,
): Promise<{ success: boolean; output: string }> {
  const res = await authFetch(accessToken, `${API_BASE}/api/remote-servers/${id}/terminal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ command }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(nestErrorMessage(text, res.statusText || `HTTP ${res.status}`));
  }
  return JSON.parse(text) as { success: boolean; output: string };
}

/** WebSocket: `GET /ws/remote-terminal?serverId=` — interactive SSH shell. */
export function remoteTerminalWsUrl(serverId: string | number): string {
  return `${wsBase()}/ws/remote-terminal?serverId=${encodeURIComponent(String(serverId))}`;
}

export function remoteTerminalWsUrlCandidates(serverId: string | number): string[] {
  const sid = encodeURIComponent(String(serverId));
  return wsBaseCandidates().map((base) => `${base}/ws/remote-terminal?serverId=${sid}`);
}

/** WebSocket: `GET /ws/local-terminal` — interactive local shell. */
export function localTerminalWsUrl(): string {
  return `${wsBase()}/ws/local-terminal`;
}

export async function fetchDockerPurgeScriptApi(
  accessToken: string,
): Promise<{ script: string }> {
  const res = await authFetch(accessToken, `${API_BASE}/api/remote-servers/docker-purge-script`, {
    method: "GET",
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(nestErrorMessage(text, res.statusText || `HTTP ${res.status}`));
  }
  const j = JSON.parse(text) as { script?: string };
  if (typeof j.script !== "string") {
    throw new Error("Invalid docker-purge-script response");
  }
  return { script: j.script };
}

export async function fetchNixpacksInstallScriptApi(
  accessToken: string,
): Promise<{ script: string }> {
  const res = await authFetch(accessToken, `${API_BASE}/api/remote-servers/nixpacks-install-script`, {
    method: "GET",
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(nestErrorMessage(text, res.statusText || `HTTP ${res.status}`));
  }
  const j = JSON.parse(text) as { script?: string };
  if (typeof j.script !== "string") {
    throw new Error("Invalid nixpacks-install-script response");
  }
  return { script: j.script };
}

export async function fetchProvisionScriptApi(
  accessToken: string,
  role: RemoteServerRole,
): Promise<{ script: string }> {
  const q = role === "build" ? "?role=build" : "?role=deploy";
  const res = await authFetch(accessToken, `${API_BASE}/api/remote-servers/provision-script${q}`, {
    method: "GET",
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(nestErrorMessage(text, res.statusText || `HTTP ${res.status}`));
  }
  const j = JSON.parse(text) as { script?: string };
  if (typeof j.script !== "string") {
    throw new Error("Invalid provision-script response");
  }
  return { script: j.script };
}

export type ProvisionJobStatus = "pending" | "running" | "done" | "error";

export type ProvisionJobKind = "provision" | "docker_purge" | "nixpacks_install";

export type ProvisionJobRow = {
  id: string;
  remoteServerId: number;
  jobKind: ProvisionJobKind;
  status: ProvisionJobStatus;
  log: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
};

export async function enqueueRemoteProvisionApi(
  accessToken: string,
  serverId: string | number,
): Promise<{ jobId: string }> {
  const res = await authFetch(accessToken, `${API_BASE}/api/remote-servers/${serverId}/provision`, {
    method: "POST",
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(nestErrorMessage(text, res.statusText || `HTTP ${res.status}`));
  }
  const j = JSON.parse(text) as { jobId?: string };
  if (typeof j.jobId !== "string") {
    throw new Error("Invalid provision enqueue response");
  }
  return { jobId: j.jobId };
}

export async function enqueueRemoteDockerPurgeApi(
  accessToken: string,
  serverId: string | number,
): Promise<{ jobId: string }> {
  const res = await authFetch(accessToken, `${API_BASE}/api/remote-servers/${serverId}/docker-purge`, {
    method: "POST",
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(nestErrorMessage(text, res.statusText || `HTTP ${res.status}`));
  }
  const j = JSON.parse(text) as { jobId?: string };
  if (typeof j.jobId !== "string") {
    throw new Error("Invalid docker-purge enqueue response");
  }
  return { jobId: j.jobId };
}

export async function enqueueRemoteNixpacksInstallApi(
  accessToken: string,
  serverId: string | number,
): Promise<{ jobId: string }> {
  const res = await authFetch(accessToken, `${API_BASE}/api/remote-servers/${serverId}/nixpacks-install`, {
    method: "POST",
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(nestErrorMessage(text, res.statusText || `HTTP ${res.status}`));
  }
  const j = JSON.parse(text) as { jobId?: string };
  if (typeof j.jobId !== "string") {
    throw new Error("Invalid nixpacks-install enqueue response");
  }
  return { jobId: j.jobId };
}

export async function fetchProvisionJobApi(
  accessToken: string,
  jobId: string,
): Promise<ProvisionJobRow> {
  const res = await authFetch(
    accessToken,
    `${API_BASE}/api/remote-servers/provision-jobs/${encodeURIComponent(jobId)}`,
    { method: "GET" },
  );
  const text = await res.text();
  if (!res.ok) {
    throw new Error(nestErrorMessage(text, res.statusText || `HTTP ${res.status}`));
  }
  const j = JSON.parse(text) as Record<string, unknown>;
  const rawKind = j.jobKind;
  const jobKind: ProvisionJobKind =
    rawKind === "docker_purge"
      ? "docker_purge"
      : rawKind === "nixpacks_install"
        ? "nixpacks_install"
        : "provision";
  return {
    id: String(j.id ?? jobId),
    remoteServerId: typeof j.remoteServerId === "number" ? j.remoteServerId : Number(j.remoteServerId),
    jobKind,
    status: (j.status as ProvisionJobStatus) ?? "pending",
    log: j.log === null || j.log === undefined ? null : String(j.log),
    errorMessage:
      j.errorMessage === null || j.errorMessage === undefined ? null : String(j.errorMessage),
    createdAt:
      j.createdAt instanceof Date
        ? j.createdAt.toISOString()
        : typeof j.createdAt === "string"
          ? j.createdAt
          : new Date().toISOString(),
    updatedAt:
      j.updatedAt instanceof Date
        ? j.updatedAt.toISOString()
        : typeof j.updatedAt === "string"
          ? j.updatedAt
          : new Date().toISOString(),
  };
}
