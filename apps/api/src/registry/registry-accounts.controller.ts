import {
  Req,
  UnauthorizedException,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Body,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { LocalSessionGuard } from '../common/guards/local-session.guard';
import { RegistryService } from './registry.service';
import { CreateRegistryAccountDto } from './dto/create-registry-account.dto';

@ApiTags('Registry')
@ApiBearerAuth()
@UseGuards(LocalSessionGuard)
@Controller('api/registry/accounts')
export class RegistryAccountsController {
  constructor(private readonly registryService: RegistryService) {}

  private uid(req?: { user?: { userId?: number } }): number {
    const id = req?.user?.userId;
    if (!id) throw new UnauthorizedException('User context missing');
    return id;
  }

  @Get()
  @ApiOperation({
    summary:
      'List saved registry credentials (passwords never returned; Dokploy-style DB storage)',
  })
  list(@Req() req: { user?: { userId: number } }) {
    return this.registryService.listAccounts(this.uid(req));
  }

  @Post()
  @ApiOperation({
    summary:
      'Verify login in an isolated Docker config, then store encrypted credentials for push/pull automation',
  })
  create(
    @Req() req: { user?: { userId: number } },
    @Body() dto: CreateRegistryAccountDto,
  ) {
    return this.registryService.createAccount(this.uid(req), dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Remove a saved registry account' })
  remove(
    @Req() req: { user?: { userId: number } },
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.registryService.removeAccount(this.uid(req), id);
  }
}
