import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable } from 'rxjs';
import multer from 'multer';
import { ServicesService } from './services.service';
import { createDeployHostImportMulterStorage } from './deploy-host-import-multer.storage';

/**
 * Parses multipart `file` by streaming it to the service deploy host over SFTP (no local disk on the API).
 */
@Injectable()
export class RemoteImportBackupInterceptor implements NestInterceptor {
  private readonly multerMw: ReturnType<typeof multer>;

  constructor(private readonly servicesService: ServicesService) {
    this.multerMw = multer({
      storage: createDeployHostImportMulterStorage(this.servicesService),
      limits: { fileSize: 512 * 1024 * 1024 },
    });
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    return new Observable((subscriber) => {
      this.multerMw.single('file')(req, res, (err: unknown) => {
        if (err) {
          subscriber.error(err);
          return;
        }
        next.handle().subscribe({
          next: (v) => subscriber.next(v),
          error: (e) => subscriber.error(e),
          complete: () => subscriber.complete(),
        });
      });
    });
  }
}
