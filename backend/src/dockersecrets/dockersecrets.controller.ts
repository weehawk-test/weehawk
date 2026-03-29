import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  InternalServerErrorException,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { DockerSecretsService } from './dockersecrets.service';
import { BulkImportDto, CreateDockersecretDto } from './dto/create-dockersecret.dto';

@ApiTags('Docker Secrets')
@Controller('docker-secrets')
export class DockerSecretsController {
  constructor(private readonly secretsService: DockerSecretsService) {}

  @Get()
  @ApiOperation({ summary: 'List all secrets' })
  async findAll() {
    return await this.secretsService.findAll();
  }

  @Get('paged')
  @ApiOperation({ summary: 'List secrets (paginated, search)' })
  async findAllPaged(
    @Query('page') pageStr?: string,
    @Query('pageSize') pageSizeStr?: string,
    @Query('q') q?: string,
  ) {
    const page = parseInt(pageStr ?? '1', 10);
    const pageSize = parseInt(pageSizeStr ?? '10', 10);
    return await this.secretsService.findAllPaged(page, pageSize, q ?? '');
  }

  @Post()
  @ApiOperation({ summary: 'Create a secret' })
  async create(@Body() dto: CreateDockersecretDto) {
    await this.secretsService.create(dto.name, dto.value);
    return { success: true, name: dto.name };
  }

  @Post('bulk-import')
  @ApiOperation({ summary: 'Import from .env' })
  async bulkImport(@Body() dto: BulkImportDto) {
    const lines = dto.envText.split('\n');
    
    const results: string[] = []; 
    const errors: Array<{ key: string; error: string }> = []; 

    for (const line of lines) {
      const trimmed = line.trim();
      
      if (trimmed && !trimmed.startsWith('#')) {
        const [key, ...valueParts] = trimmed.split('=');
        
        if (key && valueParts.length > 0) {
          const name = key.trim();
          const value = valueParts.join('=').trim();
          
          try {
            await this.secretsService.create(name, value);
            results.push(name); 
          } catch (err: any) {
            errors.push({ 
              key: name, 
              error: err.message || 'Unknown error' 
            });
          }
        }
      }
    }
    
    return { 
      message: `${results.length} secrets processed.`,
      created: results, 
      failed: errors 
    };
  }

  @Delete(':name')
  @ApiOperation({ summary: 'Delete a secret' })
  async remove(@Param('name') name: string) {
    return await this.secretsService.remove(name);
  }

  @Get(':name/inspect')
  @ApiOperation({ summary: 'Inspect secret metadata' })
  async inspect(@Param('name') name: string) {
    return await this.secretsService.findOne(name);
  }
}