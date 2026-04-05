import { API_BASE } from "./api";
import { authFetch } from "./auth-fetch";

export type RemoteServerAuthMode = "stored" | "file" | "none";

export type RemoteServerRole = "deploy" | "build";

export type RemoteServerRow = {
  id: number;
  name: string;
  host: string;
  port: number;
  sshUser: string;
  serverRole: RemoteServerRole;
  authMode: RemoteServerAuthMode;
  hasPrivateKey: boolean;
  /** Only when authMode is `file`. */
  privateKeyPath: string | null;
  extraSshOptions: string | null;
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

export async function fetchRemoteServers(accessToken: string): Promise<RemoteServerRow[]> {
  const res = await authFetch(accessToken, `${API_BASE}/api/remote-servers`, { method: "GET" });
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
  const authMode: RemoteServerAuthMode =
    am === "stored" || am === "file" || am === "none" ? am : "none";
  const sr = r.serverRole;
  const serverRole: RemoteServerRole = sr === "build" ? "build" : "deploy";
  return {
    id: typeof r.id === "number" ? r.id : Number(r.id),
    name: String(r.name ?? ""),
    host: String(r.host ?? ""),
    port: typeof r.port === "number" ? r.port : 22,
    sshUser: String(r.sshUser ?? ""),
    serverRole,
    authMode,
    hasPrivateKey: r.hasPrivateKey === true,
    privateKeyPath:
      r.privateKeyPath === null || r.privateKeyPath === undefined
        ? null
        : String(r.privateKeyPath),
    extraSshOptions:
      r.extraSshOptions === null || r.extraSshOptions === undefined
        ? null
        : String(r.extraSshOptions),
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
    extraSshOptions?: string;
    serverRole?: RemoteServerRole;
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
  id: number,
  patch: Partial<{
    name: string;
    host: string;
    port: number;
    sshUser: string;
    privateKey: string;
    extraSshOptions: string | null;
    serverRole: RemoteServerRole;
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

export async function deleteRemoteServerApi(accessToken: string, id: number): Promise<void> {
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
  id: number,
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
