type PendingDeletionEntity = "services" | "webhooks" | "cron-jobs" | "docker-secrets";

const KEY_PREFIX = "weehawk.pending-deletions.";

function keyFor(entity: PendingDeletionEntity): string {
  return `${KEY_PREFIX}${entity}`;
}

function cookieFor(entity: PendingDeletionEntity): string {
  return `${keyFor(entity)}.cookie`;
}

function normalizeId(id: string | number | null | undefined): string | null {
  if (id == null) return null;
  const v = String(id).trim();
  return v.length > 0 ? v : null;
}

function readPending(entity: PendingDeletionEntity): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const cookieRaw = readCookieValue(cookieFor(entity));
    const raw = cookieRaw || window.localStorage.getItem(keyFor(entity));
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    const out = new Set<string>();
    for (const v of parsed) {
      const n = normalizeId(typeof v === "string" || typeof v === "number" ? v : null);
      if (n) out.add(n);
    }
    return out;
  } catch {
    return new Set();
  }
}

function writePending(entity: PendingDeletionEntity, value: Set<string>): void {
  if (typeof window === "undefined") return;
  if (value.size === 0) {
    window.localStorage.removeItem(keyFor(entity));
    writeCookieValue(cookieFor(entity), "", 0);
    return;
  }
  const payload = JSON.stringify(Array.from(value));
  window.localStorage.setItem(keyFor(entity), payload);
  writeCookieValue(cookieFor(entity), encodeURIComponent(payload), 60 * 60 * 24);
}

function readCookieValue(name: string): string {
  if (typeof document === "undefined") return "";
  const parts = document.cookie.split("; ");
  for (const part of parts) {
    const i = part.indexOf("=");
    if (i <= 0) continue;
    if (part.slice(0, i) === name) return decodeURIComponent(part.slice(i + 1));
  }
  return "";
}

function writeCookieValue(name: string, value: string, maxAgeSeconds: number): void {
  if (typeof document === "undefined") return;
  document.cookie = `${name}=${value}; Path=/; Max-Age=${maxAgeSeconds}; SameSite=Lax`;
}

export function readPendingDeletionsFromCookie(
  entity: PendingDeletionEntity,
  cookieValue: string | null | undefined,
): Set<string> {
  if (!cookieValue) return new Set();
  try {
    const decoded = decodeURIComponent(cookieValue);
    const parsed = JSON.parse(decoded) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    const out = new Set<string>();
    for (const v of parsed) {
      const n = normalizeId(typeof v === "string" || typeof v === "number" ? v : null);
      if (n) out.add(n);
    }
    return out;
  } catch {
    return new Set();
  }
}

export function pendingDeletionCookieKey(entity: PendingDeletionEntity): string {
  return cookieFor(entity);
}

export function markPendingDeletion(
  entity: PendingDeletionEntity,
  ...ids: Array<string | number | null | undefined>
): void {
  const next = readPending(entity);
  for (const id of ids) {
    const n = normalizeId(id);
    if (n) next.add(n);
  }
  writePending(entity, next);
}

export function clearPendingDeletion(
  entity: PendingDeletionEntity,
  ...ids: Array<string | number | null | undefined>
): void {
  const next = readPending(entity);
  for (const id of ids) {
    const n = normalizeId(id);
    if (n) next.delete(n);
  }
  writePending(entity, next);
}

export function filterPendingDeletions<T>(
  entity: PendingDeletionEntity,
  rows: T[],
  idsForRow: (row: T) => Array<string | number | null | undefined>,
): T[] {
  if (!Array.isArray(rows) || rows.length === 0) return rows;
  const pending = readPending(entity);
  if (pending.size === 0) return rows;
  return rows.filter((row) =>
    idsForRow(row).every((id) => {
      const n = normalizeId(id);
      return !n || !pending.has(n);
    }),
  );
}

/** Client-side: current pending IDs for an entity (localStorage / cookie). */
export function readPendingDeletionSet(entity: PendingDeletionEntity): Set<string> {
  return readPending(entity);
}

export function reconcileAndFilterPendingDeletions<T>(
  entity: PendingDeletionEntity,
  rows: T[],
  idsForRow: (row: T) => Array<string | number | null | undefined>,
): T[] {
  if (!Array.isArray(rows) || rows.length === 0) return rows;
  const pending = readPending(entity);
  if (pending.size === 0) return rows;

  const idsPresentOnServer = new Set<string>();
  for (const row of rows) {
    for (const id of idsForRow(row)) {
      const n = normalizeId(id);
      if (n) idsPresentOnServer.add(n);
    }
  }

  const pruned = new Set(Array.from(pending).filter((id) => idsPresentOnServer.has(id)));
  if (pruned.size !== pending.size) {
    writePending(entity, pruned);
  }

  return rows.filter((row) =>
    idsForRow(row).every((id) => {
      const n = normalizeId(id);
      return !n || !pruned.has(n);
    }),
  );
}
