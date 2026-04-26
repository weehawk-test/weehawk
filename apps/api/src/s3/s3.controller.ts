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
  UseGuards,
  UseInterceptors,
  Req,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { S3Service } from './s3.service';
import { UpsertS3ProfileDto } from './dto/upsert-s3-profile.dto';
import { TestS3ConnectionDto } from './dto/test-s3-connection.dto';
import { MkdirS3FolderDto } from './dto/mkdir-s3-folder.dto';
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

  @Delete('profiles/:publicId')
  @ApiOperation({ summary: 'Delete a saved S3 destination profile' })
  async deleteProfile(@Req() req: { user?: { userId: number } }, @Param('publicId') publicId: string) {
    return this.s3Service.deleteProfile(this.uid(req), publicId);
  }

  @Post('test-connection')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({
    summary:
      'Verify S3-compatible connection from a deploy server (presigned ListObjects URL + curl over SSH).',
  })
  async testConnection(
    @Req() req: { user?: { userId: number } },
    @Body() dto: TestS3ConnectionDto,
  ) {
    return this.s3Service.testConnection(this.uid(req), dto);
  }

  @Get('profiles/:publicId/objects')
  @ApiOperation({
    summary: 'List objects and common prefixes under one prefix (virtual folders)',
  })
  listBucketObjects(
    @Req() req: { user?: { userId: number } },
    @Param('publicId') publicId: string,
    @Query('prefix') prefix?: string,
    @Query('continuationToken') continuationToken?: string,
  ) {
    return this.s3Service.listBucketObjects(this.uid(req), publicId, prefix, continuationToken);
  }

  @Get('profiles/:publicId/prefix-summary')
  @ApiOperation({
    summary:
      'Aggregate count, total size, and latest LastModified under a prefix (recursive)',
  })
  prefixSummary(
    @Req() req: { user?: { userId: number } },
    @Param('publicId') publicId: string,
    @Query('prefix') prefix: string | undefined,
  ) {
    if (!prefix?.trim()) {
      throw new BadRequestException('prefix query parameter is required.');
    }
    return this.s3Service.summarizePrefix(this.uid(req), publicId, prefix);
  }

  @Post('profiles/:publicId/objects/presign-put')
  @ApiOperation({
    summary:
      'Get a presigned PUT URL so the browser or another host can upload the object without sending bytes through the API',
  })
  presignPutObject(
    @Req() req: { user?: { userId: number } },
    @Param('publicId') publicId: string,
    @Body()
    body: { key?: string; contentType?: string; expiresInSeconds?: number },
  ) {
    if (!body?.key?.trim()) {
      throw new BadRequestException('key is required in body.');
    }
    return this.s3Service.presignPutObject(this.uid(req), publicId, body.key.trim(), {
      contentType: body.contentType,
      expiresInSeconds: body.expiresInSeconds,
    });
  }

  @Post('profiles/:publicId/objects/upload')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: S3Service.S3_UPLOAD_VIA_API_MAX_BYTES },
    }),
  )
  @ApiOperation({
    summary:
      'Upload object through the API (multipart). Use when browser presigned PUT fails (CORS, unreachable MinIO URL).',
  })
  uploadObjectViaApi(
    @Req() req: { user?: { userId: number } },
    @Param('publicId') publicId: string,
    @Query('key') key: string | undefined,
    @Query('contentType') contentTypeRaw: string | undefined,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    if (!key?.trim()) {
      throw new BadRequestException('key query parameter is required.');
    }
    if (!file) {
      throw new BadRequestException(
        'No file was uploaded. Choose a file and try again.',
      );
    }
    const buffer =
      file.buffer != null ? Buffer.from(file.buffer) : Buffer.alloc(0);
    const ct =
      contentTypeRaw?.trim() ||
      file.mimetype ||
      (key.trim().toLowerCase().endsWith('.gz')
        ? 'application/gzip'
        : 'application/octet-stream');
    return this.s3Service.putObjectBuffer(
      this.uid(req),
      publicId,
      key.trim(),
      buffer,
      ct,
    );
  }

  @Post('profiles/:publicId/objects/mkdir')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({
    summary: 'Create a folder marker (empty key ending with /) for S3 console-style navigation',
  })
  mkdirFolder(
    @Req() req: { user?: { userId: number } },
    @Param('publicId') publicId: string,
    @Body() body: MkdirS3FolderDto,
  ) {
    return this.s3Service.putFolderMarker(this.uid(req), publicId, body.key.trim());
  }

  @Get('profiles/:publicId/presign-get')
  @ApiOperation({
    summary:
      'Get a presigned GET URL so the browser can download the object without streaming through the API',
  })
  presignGetObject(
    @Req() req: { user?: { userId: number } },
    @Param('publicId') publicId: string,
    @Query('key') key: string | undefined,
    @Query('expiresInSeconds') expiresInSecondsRaw?: string,
  ) {
    if (!key?.trim()) {
      throw new BadRequestException('key query parameter is required.');
    }
    const n = expiresInSecondsRaw != null ? Number(expiresInSecondsRaw) : undefined;
    const expiresInSeconds =
      expiresInSecondsRaw != null && !Number.isFinite(n) ? undefined : n;
    return this.s3Service.presignGetObject(
      this.uid(req),
      publicId,
      key.trim(),
      expiresInSeconds,
    );
  }

  @Get('profiles/:publicId/download')
  @ApiOperation({ summary: 'Download object bytes (stream)' })
  async downloadObject(
    @Req() req: { user?: { userId: number } },
    @Param('publicId') publicId: string,
    @Query('key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    if (!key?.trim()) {
      throw new BadRequestException('key query parameter is required.');
    }
    const r = await this.s3Service.getObjectStream(this.uid(req), publicId, key.trim());
    const enc = encodeURIComponent(r.filename).replace(/'/g, '%27');
    res.setHeader('Content-Type', r.contentType);
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${enc}`);
    if (r.contentLength != null) {
      res.setHeader('Content-Length', String(r.contentLength));
    }
    return new StreamableFile(r.stream);
  }

  @Delete('profiles/:publicId/objects')
  @ApiOperation({ summary: 'Delete one object by key' })
  deleteObject(
    @Req() req: { user?: { userId: number } },
    @Param('publicId') publicId: string,
    @Body() body: { key?: string },
  ) {
    if (!body?.key?.trim()) {
      throw new BadRequestException('key is required in body.');
    }
    return this.s3Service.deleteObject(this.uid(req), publicId, body.key);
  }

  @Post('profiles/:publicId/objects/delete')
  @ApiOperation({
    summary:
      'Delete one object (POST with JSON body; prefer this if DELETE-with-body is blocked)',
  })
  deleteObjectPost(
    @Req() req: { user?: { userId: number } },
    @Param('publicId') publicId: string,
    @Body() body: { key?: string },
  ) {
    if (!body?.key?.trim()) {
      throw new BadRequestException('key is required in body.');
    }
    return this.s3Service.deleteObject(this.uid(req), publicId, body.key);
  }

  @Post('profiles/:publicId/objects/delete-batch')
  @ApiOperation({
    summary: 'Delete multiple objects (max 1000 keys per request)',
  })
  deleteObjectsBatch(
    @Req() req: { user?: { userId: number } },
    @Param('publicId') publicId: string,
    @Body() body: { keys?: string[] },
  ) {
    if (!body?.keys?.length) {
      throw new BadRequestException('keys array is required.');
    }
    return this.s3Service.deleteObjectsBatch(this.uid(req), publicId, body.keys);
  }

  @Post('profiles/:publicId/objects/delete-prefix')
  @ApiOperation({
    summary: 'Delete all objects whose keys start with prefix (recursive)',
  })
  deleteObjectsUnderPrefix(
    @Req() req: { user?: { userId: number } },
    @Param('publicId') publicId: string,
    @Body() body: { prefix?: string },
  ) {
    if (!body?.prefix?.trim()) {
      throw new BadRequestException('prefix is required in body.');
    }
    return this.s3Service.deleteObjectsUnderPrefix(this.uid(req), publicId, body.prefix);
  }
}
