import {
  Injectable,
  type NestInterceptor,
  type ExecutionContext,
  type CallHandler,
  HttpException,
} from '@nestjs/common';
import type { Request } from 'express';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { OrganizationAuditService } from './organization-audit.service';

/**
 * Records organization-scoped HTTP 4xx responses in the org audit log.
 * Successful mutations usually call {@link OrganizationAuditService.appendOrganizationAuditEvent}
 * explicitly; failures throw before that runs, so without this interceptor the audit trail
 * would only show successes.
 */
@Injectable()
export class OrganizationHttpFailureAuditInterceptor implements NestInterceptor {
  constructor(private readonly organizationAuditService: OrganizationAuditService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }
    const req = context.switchToHttp().getRequest<Request>();
    return next.handle().pipe(
      catchError((err: unknown) => {
        if (err instanceof HttpException) {
          void this.organizationAuditService
            .appendOrganizationSecurityFailureAuditIfApplicable(req, err)
            .catch(() => undefined);
        }
        return throwError(() => err);
      }),
    );
  }
}
