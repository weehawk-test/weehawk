import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
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

type AuthedReq = { user?: { email: string } };

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

  private uid(_req?: unknown): number {
    return 1;
  }

  @Post()
  create(@Req() req: AuthedReq, @Body() dto: CreateCronJobDto) {
    return this.cronJobsService.create(this.uid(), dto);
  }

  @Get()
  list(@Req() req: AuthedReq) {
    return this.cronJobsService.list(this.uid());
  }

  @Get(':id')
  findOne(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string) {
    return this.cronJobsService.findOne(this.uid(), id);
  }

  @Patch(':id')
  update(
    @Req() req: AuthedReq,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCronJobDto,
  ) {
    return this.cronJobsService.update(this.uid(), id, dto);
  }

  @Delete(':id')
  async remove(@Req() req: AuthedReq, @Param('id', ParseUUIDPipe) id: string) {
    await this.cronJobsService.remove(this.uid(), id);
    return { ok: true };
  }
}
