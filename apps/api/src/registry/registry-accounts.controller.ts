import {
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
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RegistryService } from './registry.service';
import { CreateRegistryAccountDto } from './dto/create-registry-account.dto';

@ApiTags('Registry')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('registry/accounts')
export class RegistryAccountsController {
  constructor(private readonly registryService: RegistryService) {}

  @Get()
  @ApiOperation({
    summary: 'List saved registry credentials (passwords never returned; Dokploy-style DB storage)',
  })
  list() {
    return this.registryService.listAccounts();
  }

  @Post()
  @ApiOperation({
    summary:
      'Verify login in an isolated Docker config, then store encrypted credentials for push/pull automation',
  })
  create(@Body() dto: CreateRegistryAccountDto) {
    return this.registryService.createAccount(dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Remove a saved registry account' })
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.registryService.removeAccount(id);
  }
}
