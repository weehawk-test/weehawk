import {
  UnauthorizedException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
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
  list(@Req() req: AuthedReq) {
    return this.cronJobsService.list(this.uid(req));
  }

  @Get(':id')
  findOne(@Req() req: AuthedReq, @Param('id', ParseIntPipe) id: number) {
    return this.cronJobsService.findOne(this.uid(req), id);
  }

  @Patch(':id')
  update(
    @Req() req: AuthedReq,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateCronJobDto,
  ) {
    return this.cronJobsService.update(this.uid(req), id, dto);
  }

  @Delete(':id')
  async remove(@Req() req: AuthedReq, @Param('id', ParseIntPipe) id: number) {
    await this.cronJobsService.remove(this.uid(req), id);
    return { ok: true };
  }
}
