import {
  UnauthorizedException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { LocalSessionGuard } from '../common/guards/local-session.guard';
import { CreateCronJobDto } from './dto/create-cron-job.dto';
import { UpdateCronJobDto } from './dto/update-cron-job.dto';
import { CronJobsService } from './cron-jobs.service';
import { ActiveOrganizationService } from '../organizations/active-organization.service';

type AuthedReq = { user?: { email: string; userId: number } };

@ApiTags('Cron Jobs')
@ApiBearerAuth()
@UseGuards(LocalSessionGuard)
@UsePipes(
  new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }),
)
@Controller('api/cron-jobs')
export class CronJobsController {
  constructor(
    private readonly cronJobsService: CronJobsService,
    private readonly activeOrganizationService: ActiveOrganizationService,
  ) {}

  private uid(req?: AuthedReq): number {
    const id = req?.user?.userId;
    if (!id) throw new UnauthorizedException('User context missing');
    return id;
  }

  private async resolveOrg(
    req: AuthedReq,
    activeOrgPublicId?: string,
  ): Promise<string | undefined> {
    const r = await this.activeOrganizationService.resolvePreferredOrganizationPublicId(
      this.uid(req),
      activeOrgPublicId,
    );
    return r ?? undefined;
  }

  @Post()
  create(@Req() req: AuthedReq, @Body() dto: CreateCronJobDto) {
    return this.cronJobsService.create(this.uid(req), dto);
  }

  @Get()
  async list(
    @Req() req: AuthedReq,
    @Query('organizationPublicId') activeOrgPublicId?: string,
  ) {
    const org = await this.resolveOrg(req, activeOrgPublicId);
    return this.cronJobsService.list(this.uid(req), org);
  }

  @Get(':id')
  async findOne(
    @Req() req: AuthedReq,
    @Param('id') id: string,
    @Query('organizationPublicId') activeOrgPublicId?: string,
  ) {
    const org = await this.resolveOrg(req, activeOrgPublicId);
    return this.cronJobsService.findOne(this.uid(req), id, org);
  }

  @Patch(':id')
  async update(
    @Req() req: AuthedReq,
    @Param('id') id: string,
    @Body() dto: UpdateCronJobDto,
    @Query('organizationPublicId') activeOrgPublicId?: string,
  ) {
    const org = await this.resolveOrg(req, activeOrgPublicId);
    return this.cronJobsService.update(
      this.uid(req),
      id,
      dto,
      org,
    );
  }

  @Post(':id/run')
  async runNow(
    @Req() req: AuthedReq,
    @Param('id') id: string,
    @Query('organizationPublicId') activeOrgPublicId?: string,
  ) {
    const org = await this.resolveOrg(req, activeOrgPublicId);
    return this.cronJobsService.triggerNow(
      this.uid(req),
      id,
      org,
    );
  }

  @Get(':id/last-run-log')
  async readLastRunLog(
    @Req() req: AuthedReq,
    @Param('id') id: string,
    @Query('lines') lines?: string,
    @Query('organizationPublicId') activeOrgPublicId?: string,
  ) {
    const parsed = lines == null ? undefined : Number(lines);
    const org = await this.resolveOrg(req, activeOrgPublicId);
    return this.cronJobsService.readLastRunLog(this.uid(req), id, {
      lines: Number.isFinite(parsed) ? parsed : undefined,
      organizationPublicId: org,
    });
  }

  @Delete(':id')
  async remove(
    @Req() req: AuthedReq,
    @Param('id') id: string,
    @Query('organizationPublicId') activeOrgPublicId?: string,
  ) {
    const org = await this.resolveOrg(req, activeOrgPublicId);
    await this.cronJobsService.remove(this.uid(req), id, org);
    return { ok: true };
  }
}
