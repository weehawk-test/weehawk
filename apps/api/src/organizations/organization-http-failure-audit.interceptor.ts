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
import { OrganizationsService } from './organizations.service';

/**
 * Records organization-scoped HTTP 4xx responses in the org audit log.
 * Successful mutations usually call {@link OrganizationsService.appendOrganizationAuditEvent}
 * explicitly; failures throw before that runs, so without this interceptor the audit trail
 * would only show successes.
 */
@Injectable()
export class OrganizationHttpFailureAuditInterceptor implements NestInterceptor {
  constructor(private readonly organizationsService: OrganizationsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }
    const req = context.switchToHttp().getRequest<Request>();
    return next.handle().pipe(
      catchError((err: unknown) => {
        if (err instanceof HttpException) {
          void this.organizationsService
            .appendOrganizationSecurityFailureAuditIfApplicable(req, err)
            .catch(() => undefined);
        }
        return throwError(() => err);
      }),
    );
  }
}
