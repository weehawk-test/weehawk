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
import { ActiveOrganizationService } from '../organizations/active-organization.service';

@ApiTags('S3')
@UseGuards(LocalSessionGuard)
@Controller('api/s3')
export class S3Controller {
  constructor(
    private readonly s3Service: S3Service,
    private readonly activeOrganizationService: ActiveOrganizationService,
  ) {}

  private uid(req?: { user?: { userId?: number } }): number {
    const id = req?.user?.userId;
    if (!id) throw new UnauthorizedException('User context missing');
    return id;
  }

  private async resolveOrg(
    req: { user?: { userId: number } },
    activeOrgPublicId?: string,
  ): Promise<string | undefined> {
    const r = await this.activeOrganizationService.resolvePreferredOrganizationPublicId(
      this.uid(req),
      activeOrgPublicId,
    );
    return r ?? undefined;
  }

  @Get('profiles')
  @ApiOperation({ summary: 'List saved S3-compatible destination profiles' })
  async listProfiles(
    @Req() req: { user?: { userId: number } },
    @Query('organizationPublicId') activeOrgPublicId?: string,
  ) {
    const org = await this.resolveOrg(req, activeOrgPublicId);
    return this.s3Service.listProfiles(this.uid(req), org);
  }

  @Post('profiles')
  @ApiOperation({ summary: 'Create or update an S3 destination profile' })
  async saveProfile(
    @Req() req: { user?: { userId: number } },
    @Body() dto: UpsertS3ProfileDto,
  ) {
    const org = await this.resolveOrg(req, dto.organizationPublicId);
    return this.s3Service.saveProfile(this.uid(req), dto, org);
  }

  @Delete('profiles/:publicId')
  @ApiOperation({ summary: 'Delete a saved S3 destination profile' })
  async deleteProfile(
    @Req() req: { user?: { userId: number } },
    @Param('publicId') publicId: string,
    @Query('organizationPublicId') activeOrgPublicId?: string,
  ) {
    const org = await this.resolveOrg(req, activeOrgPublicId);
    return this.s3Service.deleteProfile(
      this.uid(req),
      publicId,
      org,
    );
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
    const org = await this.resolveOrg(req, dto.organizationPublicId);
    return this.s3Service.testConnection(this.uid(req), dto, org);
  }

  @Get('profiles/:publicId/objects')
  @ApiOperation({
    summary:
      'List objects and common prefixes under one prefix (virtual folders)',
  })
  async listBucketObjects(
    @Req() req: { user?: { userId: number } },
    @Param('publicId') publicId: string,
    @Query('prefix') prefix?: string,
    @Query('continuationToken') continuationToken?: string,
    @Query('organizationPublicId') activeOrgPublicId?: string,
  ) {
    const org = await this.resolveOrg(req, activeOrgPublicId);
    return this.s3Service.listBucketObjects(
      this.uid(req),
      publicId,
      prefix,
      continuationToken,
      org,
    );
  }

  @Get('profiles/:publicId/prefix-summary')
  @ApiOperation({
    summary:
      'Aggregate count, total size, and latest LastModified under a prefix (recursive)',
  })
  async prefixSummary(
    @Req() req: { user?: { userId: number } },
    @Param('publicId') publicId: string,
    @Query('prefix') prefix: string | undefined,
    @Query('organizationPublicId') activeOrgPublicId?: string,
  ) {
    if (!prefix?.trim()) {
      throw new BadRequestException('prefix query parameter is required.');
    }
    const org = await this.resolveOrg(req, activeOrgPublicId);
    return this.s3Service.summarizePrefix(
      this.uid(req),
      publicId,
      prefix,
      org,
    );
  }

  @Post('profiles/:publicId/objects/presign-put')
  @ApiOperation({
    summary:
      'Get a presigned PUT URL so the browser or another host can upload the object without sending bytes through the API',
  })
  async presignPutObject(
    @Req() req: { user?: { userId: number } },
    @Param('publicId') publicId: string,
    @Body()
    body: { key?: string; contentType?: string; expiresInSeconds?: number },
    @Query('organizationPublicId') activeOrgPublicId?: string,
  ) {
    if (!body?.key?.trim()) {
      throw new BadRequestException('key is required in body.');
    }
    const org = await this.resolveOrg(req, activeOrgPublicId);
    return this.s3Service.presignPutObject(
      this.uid(req),
      publicId,
      body.key.trim(),
      {
        contentType: body.contentType,
        expiresInSeconds: body.expiresInSeconds,
        organizationPublicId: org,
      },
    );
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
  async uploadObjectViaApi(
    @Req() req: { user?: { userId: number } },
    @Param('publicId') publicId: string,
    @Query('key') key: string | undefined,
    @Query('contentType') contentTypeRaw: string | undefined,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Query('organizationPublicId') activeOrgPublicId?: string,
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
    const org = await this.resolveOrg(req, activeOrgPublicId);
    return this.s3Service.putObjectBuffer(
      this.uid(req),
      publicId,
      key.trim(),
      buffer,
      ct,
      org,
    );
  }

  @Post('profiles/:publicId/objects/mkdir')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({
    summary:
      'Create a folder marker (empty key ending with /) for S3 console-style navigation',
  })
  async mkdirFolder(
    @Req() req: { user?: { userId: number } },
    @Param('publicId') publicId: string,
    @Body() body: MkdirS3FolderDto,
    @Query('organizationPublicId') activeOrgPublicId?: string,
  ) {
    const org = await this.resolveOrg(req, activeOrgPublicId);
    return this.s3Service.putFolderMarker(
      this.uid(req),
      publicId,
      body.key.trim(),
      org,
    );
  }

  @Get('profiles/:publicId/presign-get')
  @ApiOperation({
    summary:
      'Get a presigned GET URL so the browser can download the object without streaming through the API',
  })
  async presignGetObject(
    @Req() req: { user?: { userId: number } },
    @Param('publicId') publicId: string,
    @Query('key') key: string | undefined,
    @Query('expiresInSeconds') expiresInSecondsRaw?: string,
    @Query('organizationPublicId') activeOrgPublicId?: string,
  ) {
    if (!key?.trim()) {
      throw new BadRequestException('key query parameter is required.');
    }
    const n =
      expiresInSecondsRaw != null ? Number(expiresInSecondsRaw) : undefined;
    const expiresInSeconds =
      expiresInSecondsRaw != null && !Number.isFinite(n) ? undefined : n;
    const org = await this.resolveOrg(req, activeOrgPublicId);
    return this.s3Service.presignGetObject(
      this.uid(req),
      publicId,
      key.trim(),
      expiresInSeconds,
      org,
    );
  }

  @Get('profiles/:publicId/download')
  @ApiOperation({ summary: 'Download object bytes (stream)' })
  async downloadObject(
    @Req() req: { user?: { userId: number } },
    @Param('publicId') publicId: string,
    @Query('key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
    @Query('organizationPublicId') activeOrgPublicId?: string,
  ): Promise<StreamableFile> {
    if (!key?.trim()) {
      throw new BadRequestException('key query parameter is required.');
    }
    const org = await this.resolveOrg(req, activeOrgPublicId);
    const r = await this.s3Service.getObjectStream(
      this.uid(req),
      publicId,
      key.trim(),
      org,
    );
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
  async deleteObject(
    @Req() req: { user?: { userId: number } },
    @Param('publicId') publicId: string,
    @Body() body: { key?: string },
    @Query('organizationPublicId') activeOrgPublicId?: string,
  ) {
    if (!body?.key?.trim()) {
      throw new BadRequestException('key is required in body.');
    }
    const org = await this.resolveOrg(req, activeOrgPublicId);
    return this.s3Service.deleteObject(
      this.uid(req),
      publicId,
      body.key,
      org,
    );
  }

  @Post('profiles/:publicId/objects/delete')
  @ApiOperation({
    summary:
      'Delete one object (POST with JSON body; prefer this if DELETE-with-body is blocked)',
  })
  async deleteObjectPost(
    @Req() req: { user?: { userId: number } },
    @Param('publicId') publicId: string,
    @Body() body: { key?: string },
    @Query('organizationPublicId') activeOrgPublicId?: string,
  ) {
    if (!body?.key?.trim()) {
      throw new BadRequestException('key is required in body.');
    }
    const org = await this.resolveOrg(req, activeOrgPublicId);
    return this.s3Service.deleteObject(
      this.uid(req),
      publicId,
      body.key,
      org,
    );
  }

  @Post('profiles/:publicId/objects/delete-batch')
  @ApiOperation({
    summary: 'Delete multiple objects (max 1000 keys per request)',
  })
  async deleteObjectsBatch(
    @Req() req: { user?: { userId: number } },
    @Param('publicId') publicId: string,
    @Body() body: { keys?: string[] },
    @Query('organizationPublicId') activeOrgPublicId?: string,
  ) {
    if (!body?.keys?.length) {
      throw new BadRequestException('keys array is required.');
    }
    const org = await this.resolveOrg(req, activeOrgPublicId);
    return this.s3Service.deleteObjectsBatch(
      this.uid(req),
      publicId,
      body.keys,
      org,
    );
  }

  @Post('profiles/:publicId/objects/delete-prefix')
  @ApiOperation({
    summary: 'Delete all objects whose keys start with prefix (recursive)',
  })
  async deleteObjectsUnderPrefix(
    @Req() req: { user?: { userId: number } },
    @Param('publicId') publicId: string,
    @Body() body: { prefix?: string },
    @Query('organizationPublicId') activeOrgPublicId?: string,
  ) {
    if (!body?.prefix?.trim()) {
      throw new BadRequestException('prefix is required in body.');
    }
    const org = await this.resolveOrg(req, activeOrgPublicId);
    return this.s3Service.deleteObjectsUnderPrefix(
      this.uid(req),
      publicId,
      body.prefix,
      org,
    );
  }
}
