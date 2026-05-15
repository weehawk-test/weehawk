import { buildServerApiCookieHeaders } from "@/lib/server-cookie-headers";
import { getServerApiBase } from "@/lib/server-api";
import { getServerApiKey } from "@/lib/server-api-key";
import type { OrganizationAuditLogEntry, OrganizationAuditLogPage } from "@/ee/audit/types";

async function cookieHeaders(): Promise<HeadersInit> {
  const out = new Headers(await buildServerApiCookieHeaders());
  const apiKey = getServerApiKey();
  if (apiKey) out.set("X-Weehawk-Api-Key", apiKey);
  if (!out.has("Accept")) out.set("Accept", "application/json");
  return out;
}

function apiBase(): string {
  return getServerApiBase();
}

function parseOrganizationAuditLogEntry(raw: unknown): OrganizationAuditLogEntry | null {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const created = row.createdAt;
  let createdAt: string;
  if (created instanceof Date) createdAt = created.toISOString();
  else if (typeof created === "string") createdAt = created;
  else createdAt = new Date().toISOString();
  const meta = row.metadata;
  const metadata =
    meta != null && typeof meta === "object" && !Array.isArray(meta)
      ? (meta as Record<string, unknown>)
      : null;
  return {
    id: typeof row.id === "number" ? row.id : Number(row.id ?? 0),
    action: String(row.action ?? ""),
    createdAt,
    actorUserId: typeof row.actorUserId === "number" ? row.actorUserId : Number(row.actorUserId ?? 0),
    actorEmail: String(row.actorEmail ?? ""),
    metadata,
  };
}

function emptyAuditLogPage(pageSize: number): OrganizationAuditLogPage {
  return { items: [], total: 0, page: 1, pageSize, totalPages: 0 };
}

/** Server-only: organization audit log (requires Management · Audit log or owner). */
export async function fetchOrganizationAuditLogSSR(
  activeOrgPublicId: string,
  opts?: { page?: number; pageSize?: number },
): Promise<OrganizationAuditLogPage> {
  const pageSize = opts?.pageSize ?? 12;
  const page = opts?.page ?? 1;
  const id = activeOrgPublicId.trim();
  if (!id) return emptyAuditLogPage(pageSize);

  const qs = new URLSearchParams();
  qs.set("page", String(page));
  qs.set("pageSize", String(pageSize));
  const res = await fetch(
    `${apiBase()}/api/organizations/${encodeURIComponent(id)}/audit-log?${qs.toString()}`,
    {
      headers: await cookieHeaders(),
      cache: "no-store",
    },
  );
  if (!res.ok) return emptyAuditLogPage(pageSize);

  const data = (await res.json()) as unknown;
  if (data != null && typeof data === "object" && !Array.isArray(data)) {
    const obj = data as Record<string, unknown>;
    const itemsRaw = obj.items;
    const items: OrganizationAuditLogEntry[] = [];
    if (Array.isArray(itemsRaw)) {
      for (const raw of itemsRaw) {
        const e = parseOrganizationAuditLogEntry(raw);
        if (e) items.push(e);
      }
    }
    const total = typeof obj.total === "number" ? obj.total : Number(obj.total ?? 0);
    const p = typeof obj.page === "number" ? obj.page : Number(obj.page ?? 1);
    const ps = typeof obj.pageSize === "number" ? obj.pageSize : Number(obj.pageSize ?? pageSize);
    const tp = typeof obj.totalPages === "number" ? obj.totalPages : Number(obj.totalPages ?? 0);
    return {
      items,
      total: Number.isFinite(total) ? total : 0,
      page: Number.isFinite(p) && p >= 1 ? p : 1,
      pageSize: Number.isFinite(ps) && ps >= 1 ? ps : pageSize,
      totalPages: Number.isFinite(tp) ? Math.max(0, tp) : 0,
    };
  }

  if (Array.isArray(data)) {
    const items: OrganizationAuditLogEntry[] = [];
    for (const raw of data) {
      const e = parseOrganizationAuditLogEntry(raw);
      if (e) items.push(e);
    }
    return {
      items,
      total: items.length,
      page: 1,
      pageSize: items.length || pageSize,
      totalPages: items.length > 0 ? 1 : 0,
    };
  }

  return emptyAuditLogPage(pageSize);
}
