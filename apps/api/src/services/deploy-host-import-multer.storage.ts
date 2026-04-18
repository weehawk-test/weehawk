import {
  BadRequestException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import type { Readable } from 'stream';
import type { StorageEngine } from 'multer';
import type { ServicesService } from './services.service';

export function createDeployHostImportMulterStorage(
  servicesService: ServicesService,
): StorageEngine {
  return {
    _handleFile(
      req: Request & { user?: { userId: number } },
      file: Express.Multer.File & { stream?: Readable },
      cb: (error?: Error, info?: Partial<Express.Multer.File>) => void,
    ): void {
      void (async () => {
        try {
          const userId = req.user?.userId;
          if (userId == null) {
            cb(new UnauthorizedException('User context missing'));
            return;
          }
          const idParam = req.params['id'];
          if (typeof idParam !== 'string' || !idParam.trim()) {
            cb(new BadRequestException('Missing service id.'));
            return;
          }
          const stream = file.stream;
          if (!stream) {
            cb(new BadRequestException('Upload stream missing.'));
            return;
          }
          const { stagingDir, remotePath, remoteServerId } =
            await servicesService.pipeImportMultipartStreamToDeployHost(
              userId,
              idParam.trim(),
              file.originalname ?? '',
              stream,
            );
          cb(undefined, {
            path: remotePath,
            destination: stagingDir,
            filename: file.originalname ?? '',
            size: 0,
            remoteStagingDir: stagingDir,
            remoteFilePath: remotePath,
            remoteServerId,
          } as unknown as Partial<Express.Multer.File>);
        } catch (e) {
          if (
            e instanceof UnauthorizedException ||
            e instanceof BadRequestException ||
            e instanceof NotFoundException
          ) {
            cb(e);
            return;
          }
          cb(e instanceof Error ? e : new Error(String(e)));
        }
      })();
    },
    _removeFile(
      _req: Request,
      file: Express.Multer.File & {
        remoteStagingDir?: string;
        remoteServerId?: number;
      },
      cb: (error: Error | null) => void,
    ): void {
      const stagingDir = file.remoteStagingDir;
      const remoteServerId = file.remoteServerId;
      if (stagingDir != null && remoteServerId != null) {
        void servicesService
          .removeDeployHostImportStaging(remoteServerId, stagingDir)
          .catch(() => {})
          .finally(() => cb(null));
      } else {
        cb(null);
      }
    },
  };
}
