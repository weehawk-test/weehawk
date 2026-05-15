export type OrganizationAuditLogEntry = {
  id: number;
  action: string;
  createdAt: string;
  actorUserId: number;
  actorEmail: string;
  metadata: Record<string, unknown> | null;
};

export type OrganizationAuditLogPage = {
  items: OrganizationAuditLogEntry[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};
