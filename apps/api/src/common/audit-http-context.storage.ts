import { AsyncLocalStorage } from 'async_hooks';

/** Minimal response shape: Express sets `statusCode` as the handler runs. */
export type AuditHttpContextResponse = { statusCode?: number };

export type AuditHttpContextStore = {
  res: AuditHttpContextResponse;
};

export const auditHttpContextStorage =
  new AsyncLocalStorage<AuditHttpContextStore>();
