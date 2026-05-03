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
  constructor(private readonly cronJobsService: CronJobsService) {}

  private uid(req?: AuthedReq): number {
    const id = req?.user?.userId;
    if (!id) throw new UnauthorizedException('User context missing');
    return id;
  }

  @Post()
  create(@Req() req: AuthedReq, @Body() dto: CreateCronJobDto) {
    return this.cronJobsService.create(this.uid(req), dto);
  }

  @Get()
  list(
    @Req() req: AuthedReq,
    @Query('organizationPublicId') organizationPublicId?: string,
  ) {
    return this.cronJobsService.list(this.uid(req), organizationPublicId);
  }

  @Get(':id')
  findOne(
    @Req() req: AuthedReq,
    @Param('id') id: string,
    @Query('organizationPublicId') organizationPublicId?: string,
  ) {
    return this.cronJobsService.findOne(this.uid(req), id, organizationPublicId);
  }

  @Patch(':id')
  update(
    @Req() req: AuthedReq,
    @Param('id') id: string,
    @Body() dto: UpdateCronJobDto,
    @Query('organizationPublicId') organizationPublicId?: string,
  ) {
    return this.cronJobsService.update(
      this.uid(req),
      id,
      dto,
      organizationPublicId,
    );
  }

  @Post(':id/run')
  runNow(
    @Req() req: AuthedReq,
    @Param('id') id: string,
    @Query('organizationPublicId') organizationPublicId?: string,
  ) {
    return this.cronJobsService.triggerNow(
      this.uid(req),
      id,
      organizationPublicId,
    );
  }

  @Get(':id/last-run-log')
  readLastRunLog(
    @Req() req: AuthedReq,
    @Param('id') id: string,
    @Query('lines') lines?: string,
    @Query('organizationPublicId') organizationPublicId?: string,
  ) {
    const parsed = lines == null ? undefined : Number(lines);
    return this.cronJobsService.readLastRunLog(this.uid(req), id, {
      lines: Number.isFinite(parsed) ? parsed : undefined,
      organizationPublicId,
    });
  }

  @Delete(':id')
  async remove(
    @Req() req: AuthedReq,
    @Param('id') id: string,
    @Query('organizationPublicId') organizationPublicId?: string,
  ) {
    await this.cronJobsService.remove(this.uid(req), id, organizationPublicId);
    return { ok: true };
  }
}
