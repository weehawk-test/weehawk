import {
  Injectable,
  type NestInterceptor,
  type ExecutionContext,
  type CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { auditHttpContextStorage } from './audit-http-context.storage';
import type { AuditHttpContextResponse } from './audit-http-context.storage';

/**
 * Keeps the current HTTP response on AsyncLocalStorage so organization audit
 * rows can attach `httpStatus` without every caller passing it explicitly.
 */
@Injectable()
export class AuditHttpContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }
    const res = context
      .switchToHttp()
      .getResponse<AuditHttpContextResponse>();
    return new Observable((downstream) => {
      let inner: { unsubscribe(): void } | undefined;
      auditHttpContextStorage.run({ res }, () => {
        inner = next.handle().subscribe(downstream);
      });
      return () => inner?.unsubscribe();
    });
  }
}
