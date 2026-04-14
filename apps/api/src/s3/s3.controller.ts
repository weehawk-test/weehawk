import {
  UnauthorizedException,
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
  UseGuards,
  Req,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { diskStorage } from 'multer';
import * as os from 'os';
import { randomBytes } from 'crypto';
import * as fs from 'fs/promises';
import type { Response } from 'express';
import { S3Service } from './s3.service';
import { UpsertS3ProfileDto } from './dto/upsert-s3-profile.dto';
import { LocalSessionGuard } from '../common/guards/local-session.guard';

@ApiTags('S3')
@UseGuards(LocalSessionGuard)
@Controller('api/s3')
export class S3Controller {
  constructor(private readonly s3Service: S3Service) {}

  private uid(req?: { user?: { userId?: number } }): number {
    const id = req?.user?.userId;
    if (!id) throw new UnauthorizedException('User context missing');
    return id;
  }

  @Get('profiles')
  @ApiOperation({ summary: 'List saved S3-compatible destination profiles' })
  async listProfiles(@Req() req: { user?: { userId: number } }) {
    return this.s3Service.listProfiles(this.uid(req));
  }

  @Post('profiles')
  @ApiOperation({ summary: 'Create or update an S3 destination profile' })
  async saveProfile(@Req() req: { user?: { userId: number } }, @Body() dto: UpsertS3ProfileDto) {
    return this.s3Service.saveProfile(this.uid(req), dto);
  }

  @Delete('profiles/:name')
  @ApiOperation({ summary: 'Delete a saved S3 destination profile' })
  async deleteProfile(@Req() req: { user?: { userId: number } }, @Param('name') name: string) {
    return this.s3Service.deleteProfile(this.uid(req), name);
  }

  @Post('test-connection')
  @ApiOperation({
    summary: 'Verify S3-compatible connection (AWS SDK ListObjectsV2)',
  })
  async testConnection(@Body() dto: UpsertS3ProfileDto) {
    return this.s3Service.testConnection(dto);
  }

  @Get('profiles/:name/objects')
  @ApiOperation({
    summary: 'List objects and common prefixes under one prefix (virtual folders)',
  })
  listBucketObjects(
    @Req() req: { user?: { userId: number } },
    @Param('name') name: string,
    @Query('prefix') prefix?: string,
    @Query('continuationToken') continuationToken?: string,
  ) {
    return this.s3Service.listBucketObjects(this.uid(req), name, prefix, continuationToken);
  }

  @Get('profiles/:name/prefix-summary')
  @ApiOperation({
    summary:
      'Aggregate count, total size, and latest LastModified under a prefix (recursive)',
  })
  prefixSummary(
    @Req() req: { user?: { userId: number } },
    @Param('name') name: string,
    @Query('prefix') prefix: string | undefined,
  ) {
    if (!prefix?.trim()) {
      throw new BadRequestException('prefix query parameter is required.');
    }
    return this.s3Service.summarizePrefix(this.uid(req), name, prefix);
  }

  @Get('profiles/:name/download')
  @ApiOperation({ summary: 'Download object bytes (stream)' })
  async downloadObject(
    @Req() req: { user?: { userId: number } },
    @Param('name') name: string,
    @Query('key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    if (!key?.trim()) {
      throw new BadRequestException('key query parameter is required.');
    }
    const r = await this.s3Service.getObjectStream(this.uid(req), name, key.trim());
    const enc = encodeURIComponent(r.filename).replace(/'/g, '%27');
    res.setHeader('Content-Type', r.contentType);
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${enc}`);
    if (r.contentLength != null) {
      res.setHeader('Content-Length', String(r.contentLength));
    }
    return new StreamableFile(r.stream);
  }

  @Delete('profiles/:name/objects')
  @ApiOperation({ summary: 'Delete one object by key' })
  deleteObject(
    @Req() req: { user?: { userId: number } },
    @Param('name') name: string,
    @Body() body: { key?: string },
  ) {
    if (!body?.key?.trim()) {
      throw new BadRequestException('key is required in body.');
    }
    return this.s3Service.deleteObject(this.uid(req), name, body.key);
  }

  @Post('profiles/:name/objects/delete')
  @ApiOperation({
    summary:
      'Delete one object (POST with JSON body; prefer this if DELETE-with-body is blocked)',
  })
  deleteObjectPost(
    @Req() req: { user?: { userId: number } },
    @Param('name') name: string,
    @Body() body: { key?: string },
  ) {
    if (!body?.key?.trim()) {
      throw new BadRequestException('key is required in body.');
    }
    return this.s3Service.deleteObject(this.uid(req), name, body.key);
  }

  @Post('profiles/:name/objects/delete-batch')
  @ApiOperation({
    summary: 'Delete multiple objects (max 1000 keys per request)',
  })
  deleteObjectsBatch(
    @Req() req: { user?: { userId: number } },
    @Param('name') name: string,
    @Body() body: { keys?: string[] },
  ) {
    if (!body?.keys?.length) {
      throw new BadRequestException('keys array is required.');
    }
    return this.s3Service.deleteObjectsBatch(this.uid(req), name, body.keys);
  }

  @Post('profiles/:name/objects/delete-prefix')
  @ApiOperation({
    summary: 'Delete all objects whose keys start with prefix (recursive)',
  })
  deleteObjectsUnderPrefix(
    @Req() req: { user?: { userId: number } },
    @Param('name') name: string,
    @Body() body: { prefix?: string },
  ) {
    if (!body?.prefix?.trim()) {
      throw new BadRequestException('prefix is required in body.');
    }
    return this.s3Service.deleteObjectsUnderPrefix(this.uid(req), name, body.prefix);
  }

  @Post('profiles/:name/objects/upload')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 512 * 1024 * 1024 },
      storage: diskStorage({
        destination: os.tmpdir(),
        filename: (_req, _file, cb) => {
          cb(null, `weehawk-s3up-${randomBytes(16).toString('hex')}`);
        },
      }),
    }),
  )
  @ApiOperation({ summary: 'Upload a file to the bucket' })
  async uploadObject(
    @Req() req: { user?: { userId: number } },
    @Param('name') name: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body('key') objectKey: string | undefined,
  ) {
    if (!file?.path) {
      throw new BadRequestException('file is required.');
    }
    if (!objectKey?.trim()) {
      throw new BadRequestException(
        'key is required (full object key in bucket).',
      );
    }
    try {
      return await this.s3Service.uploadLocalFile(
        this.uid(req),
        name,
        file.path,
        objectKey.trim(),
      );
    } finally {
      await fs.unlink(file.path).catch(() => {});
    }
  }
}
