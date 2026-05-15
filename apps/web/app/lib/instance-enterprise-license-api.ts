import { API_BASE } from "./api";
import { authFetch } from "./auth-fetch";

export type InstanceEnterpriseLicenseState = {
  licensed: boolean;
  salesUrl: string;
  selfHosted: boolean;
  canManageInstanceLicense: boolean;
  signedLicenseEnforced: boolean;
  hasStoredLicenseKey?: boolean;
};

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

const jsonHeaders: HeadersInit = {
  Accept: "application/json",
};

export async function getInstanceEnterpriseLicenseState(
  accessToken: string | null,
): Promise<InstanceEnterpriseLicenseState> {
  const res = await authFetch(accessToken, `${API_BASE}/api/enterprise/instance-license`, {
    method: "GET",
    headers: jsonHeaders,
  });
  if (!res.ok) throw new Error(await errorBody(res));
  return res.json();
}

export async function updateInstanceEnterpriseLicenseKey(
  accessToken: string | null,
  licenseKey: string,
): Promise<{ licensed: boolean; message: string }> {
  const res = await authFetch(accessToken, `${API_BASE}/api/enterprise/instance-license`, {
    method: "PUT",
    headers: {
      ...jsonHeaders,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ licenseKey }),
  });
  if (!res.ok) throw new Error(await errorBody(res));
  return res.json();
}
