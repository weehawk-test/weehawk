import { API_BASE } from "./api";

export type CronJobListItem = {
  id: number;
  /** URL-safe id; prefer for routes and links. */
  publicId?: string;
  name: string;
  description: string;
  isActive: boolean;
  triggerType: "cron";
  cronExpression: string;
  remoteServerId: number;
  notifyOnTrigger: boolean;
  createdAt: string;
  summary: string;
};

export type CronJobDetail = CronJobListItem & {
  bashScript: string;
  notifyChannelId: number | null;
  notifyMessage: string | null;
};

export function cronJobRouteId(j: { publicId?: string | null; id: number }): string {
  const p = j.publicId?.trim();
  return p ? p : String(j.id);
}

export type CreateCronJobBody = {
  name: string;
  description?: string;
  cronExpression: string;
  remoteServerId: number;
  bashScript: string;
  notifyChannelId?: number;
  notifyMessage?: string;
  organizationPublicId?: string;
};

export type UpdateCronJobBody = {
  name?: string;
  description?: string;
  cronExpression?: string;
  isActive?: boolean;
  remoteServerId?: number;
  bashScript?: string;
  notifyChannelId?: number | null;
  notifyMessage?: string | null;
};

async function errorBody(res: Response): Promise<string> {
  const text = await res.text();
  try {
    const j = JSON.parse(text) as { message?: string | string[] };
    if (Array.isArray(j.message)) return j.message.join(", ");
    if (typeof j.message === "string") return j.message;
  } catch {}
  return text || res.statusText;
}

function authHeaders(_accessToken: string): HeadersInit {
  return { Accept: "application/json" };
}

export async function fetchCronJobs(
  accessToken: string,
  organizationPublicId?: string | null,
): Promise<CronJobListItem[]> {
  const org = organizationPublicId?.trim();
  const q = org ? `?organizationPublicId=${encodeURIComponent(org)}` : "";
  const res = await fetch(`${API_BASE}/api/cron-jobs${q}`, {
    headers: authHeaders(accessToken),
    credentials: "include",
  });
  if (!res.ok) throw new Error(await errorBody(res));
  const data = (await res.json()) as Omit<CronJobListItem, "triggerType">[];
  return data.map((j) => ({
    ...j,
    publicId:
      j.publicId == null || String(j.publicId).trim() === "" ? undefined : String(j.publicId),
    triggerType: "cron" as const,
  }));
}

export async function fetchCronJob(
  accessToken: string,
  id: string | number,
  organizationPublicId?: string | null,
): Promise<CronJobDetail> {
  const org = organizationPublicId?.trim();
  const q = org ? `?organizationPublicId=${encodeURIComponent(org)}` : "";
  const res = await fetch(`${API_BASE}/api/cron-jobs/${encodeURIComponent(String(id))}${q}`, {
    headers: authHeaders(accessToken),
    credentials: "include",
  });
  if (!res.ok) throw new Error(await errorBody(res));
  const data = (await res.json()) as Omit<CronJobDetail, "triggerType">;
  return {
    ...data,
    publicId:
      data.publicId == null || String(data.publicId).trim() === ""
        ? undefined
        : String(data.publicId),
    triggerType: "cron",
  };
}

export async function createCronJob(
  accessToken: string,
  body: CreateCronJobBody,
): Promise<CronJobDetail> {
  const res = await fetch(`${API_BASE}/api/cron-jobs`, {
    method: "POST",
    headers: {
      ...authHeaders(accessToken),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    credentials: "include",
  });
  if (!res.ok) throw new Error(await errorBody(res));
  const data = (await res.json()) as Omit<CronJobDetail, "triggerType">;
  return {
    ...data,
    publicId:
      data.publicId == null || String(data.publicId).trim() === ""
        ? undefined
        : String(data.publicId),
    triggerType: "cron",
  };
}

export async function updateCronJob(
  accessToken: string,
  id: string | number,
  body: UpdateCronJobBody,
  organizationPublicId?: string | null,
): Promise<CronJobDetail> {
  const org = organizationPublicId?.trim();
  const q = org ? `?organizationPublicId=${encodeURIComponent(org)}` : "";
  const res = await fetch(`${API_BASE}/api/cron-jobs/${encodeURIComponent(String(id))}${q}`, {
    method: "PATCH",
    headers: {
      ...authHeaders(accessToken),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    credentials: "include",
  });
  if (!res.ok) throw new Error(await errorBody(res));
  const data = (await res.json()) as Omit<CronJobDetail, "triggerType">;
  return {
    ...data,
    publicId:
      data.publicId == null || String(data.publicId).trim() === ""
        ? undefined
        : String(data.publicId),
    triggerType: "cron",
  };
}

export async function deleteCronJob(
  accessToken: string,
  id: string | number,
  organizationPublicId?: string | null,
): Promise<void> {
  const org = organizationPublicId?.trim();
  const q = org ? `?organizationPublicId=${encodeURIComponent(org)}` : "";
  const res = await fetch(`${API_BASE}/api/cron-jobs/${encodeURIComponent(String(id))}${q}`, {
    method: "DELETE",
    headers: authHeaders(accessToken),
    credentials: "include",
  });
  if (!res.ok) throw new Error(await errorBody(res));
}

export async function triggerCronJobNow(
  accessToken: string,
  id: string | number,
  organizationPublicId?: string | null,
): Promise<{ ok: boolean; success: boolean; action: string; output: string }> {
  const org = organizationPublicId?.trim();
  const q = org ? `?organizationPublicId=${encodeURIComponent(org)}` : "";
  const res = await fetch(
    `${API_BASE}/api/cron-jobs/${encodeURIComponent(String(id))}/run${q}`,
    {
      method: "POST",
      headers: authHeaders(accessToken),
      credentials: "include",
    },
  );
  if (!res.ok) throw new Error(await errorBody(res));
  return (await res.json()) as { ok: boolean; success: boolean; action: string; output: string };
}

export async function fetchCronJobLastRunLog(
  accessToken: string,
  id: string | number,
  lines = 200,
  organizationPublicId?: string | null,
): Promise<{ log: string; source: string }> {
  const params = new URLSearchParams({ lines: String(lines) });
  const org = organizationPublicId?.trim();
  if (org) params.set("organizationPublicId", org);
  const qs = params.toString();
  const res = await fetch(
    `${API_BASE}/api/cron-jobs/${encodeURIComponent(String(id))}/last-run-log?${qs}`,
    {
      headers: authHeaders(accessToken),
      credentials: "include",
    },
  );
  if (!res.ok) throw new Error(await errorBody(res));
  return (await res.json()) as { log: string; source: string };
}
