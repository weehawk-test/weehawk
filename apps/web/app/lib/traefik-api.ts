import { API_BASE } from "./api";
import { authFetch } from "./auth-fetch";

export type TraefikSettingsPayload = {
  id: number;
  acmeEmail: string;
  platformDomain: string | null;
  acmeStorageHostPath: string;
  dockerNetwork: string;
  traefikImage: string;
  certResolverName: string;
  httpEntrypoint: string;
  httpsEntrypoint: string;
  redirectHttpToHttps: boolean;
  dashboardEnabled: boolean;
  swarmMode: boolean;
  staticConfigOverride: string | null;
  updatedAt: string | null;
  generatedStackCompose: string;
  generatedStaticConfig: string;
  /** File-provider YAML for Weehawk UI → host:3000; empty when no domain. */
  generatedPlatformDynamicConfig: string;
};

export type TraefikSettingsPatch = Partial<{
  acmeEmail: string;
  platformDomain: string;
  certResolverName: string;
  acmeStorageHostPath: string;
  httpEntrypoint: string;
  httpsEntrypoint: string;
  redirectHttpToHttps: boolean;
  traefikImage: string;
}>;

async function errorBody(res: Response): Promise<string> {
  const text = await res.text();
  try {
    const j = JSON.parse(text) as { message?: string | string[] };
    if (Array.isArray(j.message)) return j.message.join(", ");
    if (typeof j.message === "string") return j.message;
  } catch {
    /* ignore */
  }
  return text || res.statusText;
}

export async function fetchTraefikSettings(accessToken: string): Promise<TraefikSettingsPayload> {
  const res = await authFetch(accessToken, `${API_BASE}/api/traefik/settings`, { method: "GET" });
  if (!res.ok) throw new Error(await errorBody(res));
  return res.json();
}

export async function updateTraefikSettings(
  accessToken: string,
  patch: TraefikSettingsPatch,
): Promise<TraefikSettingsPayload> {
  const res = await authFetch(accessToken, `${API_BASE}/api/traefik/settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(await errorBody(res));
  return res.json();
}
