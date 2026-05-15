import {
  ForbiddenException,
  HttpException,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Repository } from 'typeorm';
import { User } from '../../auth/entities/user.entity';
import { OrganizationsRepository } from '../../organizations/organizations.repository';
import { parseOrganizationPublicIdParam } from '../../organizations/org-public-id';
import { ORGANIZATION_WORKSPACE_PERMISSIONS } from '../../organizations/organization-workspace-permissions';
import type { OrganizationMemberContext } from '../../organizations/organization-member-context';
import { OrganizationAuditLog } from './organization-audit-log.entity';
import { auditHttpContextStorage } from './audit-http-context.storage';
import { EnterpriseLicenseService } from '../license-token';

export type OrganizationAuditLogPublicDto = {
  id: number;
  action: string;
  createdAt: string;
  actorUserId: number;
  actorEmail: string;
  metadata: Record<string, unknown> | null;
};

export type OrganizationAuditLogPageDto = {
  items: OrganizationAuditLogPublicDto[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

@Injectable()
export class OrganizationAuditService {
  constructor(
    private readonly repo: OrganizationsRepository,
    @InjectRepository(OrganizationAuditLog)
    private readonly auditLogs: Repository<OrganizationAuditLog>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    private readonly enterpriseLicense: EnterpriseLicenseService,
  ) {}

  /** Merge `httpStatus` from the current HTTP response when missing from metadata. */
  private mergeAuditMetadataWithHttpStatus(
    metadata: Record<string, unknown> | null | undefined,
  ): Record<string, unknown> | null {
    const base: Record<string, unknown> =
      metadata != null && typeof metadata === 'object' && !Array.isArray(metadata)
        ? { ...metadata }
        : {};
    const explicit = base.httpStatus;
    const hasExplicit =
      explicit !== undefined &&
      explicit !== null &&
      !(typeof explicit === 'string' && explicit.trim() === '');
    if (!hasExplicit) {
      const res = auditHttpContextStorage.getStore()?.res;
      const code = res?.statusCode;
      if (
        typeof code === 'number' &&
        Number.isFinite(code) &&
        code >= 100 &&
        code <= 599
      ) {
        base.httpStatus = code;
      }
    }
    return Object.keys(base).length > 0 ? base : null;
  }

  /** Append a row to the organization audit log (best-effort callers await). */
  async appendOrganizationAuditEvent(
    organizationInternalId: number,
    actorUserId: number,
    action: string,
    options?: {
      metadata?: Record<string, unknown> | null;
    },
  ): Promise<void> {
    const row = this.auditLogs.create({
      organizationId: organizationInternalId,
      actorUserId,
      action: action.trim().slice(0, 64),
      metadata: this.mergeAuditMetadataWithHttpStatus(options?.metadata),
    });
    await this.auditLogs.save(row);
  }

  private static tryParseOrganizationPublicIdForAudit(
    raw: unknown,
  ): string | null {
    try {
      return parseOrganizationPublicIdParam(raw);
    } catch {
      return null;
    }
  }

  private static shouldSkipHttpFailureAuditPath(urlPath: string): boolean {
    if (!urlPath.startsWith('/api/')) {
      return true;
    }
    if (
      urlPath.startsWith('/api/webhooks') ||
      urlPath.startsWith('/api/cron-jobs')
    ) {
      return true;
    }
    return false;
  }

  private static summarizeHttpException(exception: HttpException): string {
    const r = exception.getResponse();
    if (typeof r === 'string') {
      return r.trim().slice(0, 400);
    }
    if (r && typeof r === 'object' && 'message' in r) {
      const m = (r as { message: unknown }).message;
      if (typeof m === 'string') return m.trim().slice(0, 400);
      if (Array.isArray(m)) {
        return m
          .map((x) => String(x))
          .join('; ')
          .trim()
          .slice(0, 400);
      }
    }
    return exception.message.trim().slice(0, 400);
  }

  /**
   * When an org-scoped API call returns 4xx, append a row so the audit log includes
   * denied / validation failures, not only successful mutations.
   */
  async appendOrganizationSecurityFailureAuditIfApplicable(
    req: Request,
    exception: HttpException,
  ): Promise<void> {
    const status = exception.getStatus();
    if (!Number.isFinite(status) || status < 400 || status >= 500) {
      return;
    }
    const userIdRaw = (req as Request & { user?: { userId?: number } }).user
      ?.userId;
    if (
      typeof userIdRaw !== 'number' ||
      !Number.isFinite(userIdRaw) ||
      userIdRaw < 1
    ) {
      return;
    }
    const userId = Math.trunc(userIdRaw);

    const q = req.query as Record<string, unknown> | undefined;
    const b = req.body as Record<string, unknown> | undefined;
    const rawOrg = q?.['organizationPublicId'] ?? b?.['organizationPublicId'];
    const orgPublicId =
      OrganizationAuditService.tryParseOrganizationPublicIdForAudit(rawOrg);
    if (!orgPublicId) {
      return;
    }

    const path =
      typeof req.path === 'string' && req.path.length > 0
        ? req.path
        : new URL(req.url, 'http://localhost').pathname;
    if (OrganizationAuditService.shouldSkipHttpFailureAuditPath(path)) {
      return;
    }

    const org = await this.repo.findByPublicId(orgPublicId);
    if (!org) {
      return;
    }

    const member = await this.repo.findMembership(userId, org.id);
    const isMember = Boolean(member);
    const reason: string = !isMember
      ? 'not_organization_member'
      : status === 403
        ? 'forbidden'
        : status === 404
          ? 'not_found'
          : status === 422
            ? 'validation'
            : status === 409
              ? 'conflict'
              : 'client_error';

    const method = String(req.method ?? 'GET').toUpperCase();
    const fullPath =
      typeof req.originalUrl === 'string' && req.originalUrl.length > 0
        ? req.originalUrl.split('?')[0] ?? path
        : path;
    const endpoint = `${method} ${fullPath}`.slice(0, 512);
    const errorSummary =
      OrganizationAuditService.summarizeHttpException(exception);

    await this.appendOrganizationAuditEvent(
      org.id,
      userId,
      'security.http.request_rejected',
      {
        metadata: {
          endpoint,
          httpStatus: status,
          organizationPublicId: orgPublicId,
          reason,
          errorSummary,
        },
      },
    );
  }

  async listAuditLogsForOrg(
    ctx: OrganizationMemberContext,
    opts?: { page?: number; pageSize?: number },
  ): Promise<OrganizationAuditLogPageDto> {
    if (!this.enterpriseLicense.isLicensed()) {
      throw new ForbiddenException({
        message: 'Enterprise license required to view the organization audit log.',
        code: 'ENTERPRISE_LICENSE_REQUIRED',
        salesUrl: this.enterpriseLicense.getSalesUrl(),
      });
    }
    if (
      !ctx.actingIsOwner &&
      !ctx.workspacePermissions[
        ORGANIZATION_WORKSPACE_PERMISSIONS.ORGANIZATION_MANAGEMENT_AUDIT_LOG
      ]
    ) {
      throw new ForbiddenException(
        'You do not have permission to view the organization audit log.',
      );
    }
    const rawPage = Number(opts?.page ?? 1);
    const rawSize = Number(opts?.pageSize ?? 12);
    const pageSize = Math.min(
      50,
      Math.max(1, Number.isFinite(rawSize) ? Math.trunc(rawSize) : 12),
    );
    let page = Math.max(1, Number.isFinite(rawPage) ? Math.trunc(rawPage) : 1);

    const total = await this.auditLogs.count({
      where: { organizationId: ctx.internalId },
    });
    const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);
    if (totalPages > 0) {
      page = Math.min(page, totalPages);
    }

    const skip = (page - 1) * pageSize;
    const rows = await this.auditLogs.find({
      where: { organizationId: ctx.internalId },
      order: { createdAt: 'DESC' },
      skip,
      take: pageSize,
    });
    if (rows.length === 0) {
      return {
        items: [],
        total,
        page: total === 0 ? 1 : page,
        pageSize,
        totalPages,
      };
    }
    const actorIds = [...new Set(rows.map((r) => r.actorUserId))];
    const actors = await this.users.find({ where: { id: In(actorIds) } });
    const emailById = new Map(actors.map((u) => [u.id, u.email]));
    const items = rows.map((r) => ({
      id: r.id,
      action: r.action,
      createdAt: r.createdAt.toISOString(),
      actorUserId: r.actorUserId,
      actorEmail: emailById.get(r.actorUserId) ?? '(unknown)',
      metadata: r.metadata,
    }));
    return { items, total, page, pageSize, totalPages };
  }

  async deleteAllForOrganizationInTransaction(
    em: EntityManager,
    organizationId: number,
  ): Promise<void> {
    await em.delete(OrganizationAuditLog, { organizationId });
  }
}
