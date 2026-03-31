import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { S3Service } from './s3.service';
import { UpsertS3ProfileDto } from './dto/upsert-s3-profile.dto';

@ApiTags('S3')
@Controller('s3')
export class S3Controller {
  constructor(private readonly s3Service: S3Service) {}

  @Get('profiles')
  @ApiOperation({ summary: 'List saved S3/rclone profiles' })
  async listProfiles() {
    return this.s3Service.listProfiles();
  }

  @Post('profiles')
  @ApiOperation({ summary: 'Create or update an S3/rclone profile' })
  async saveProfile(@Body() dto: UpsertS3ProfileDto) {
    return this.s3Service.saveProfile(dto);
  }

  @Delete('profiles/:name')
  @ApiOperation({ summary: 'Delete a saved S3/rclone profile' })
  async deleteProfile(@Param('name') name: string) {
    return this.s3Service.deleteProfile(name);
  }

  @Post('test-connection')
  @ApiOperation({ summary: 'Verify S3 connection using rclone' })
  async testConnection(@Body() dto: UpsertS3ProfileDto) {
    return this.s3Service.testConnection(dto);
  }
}
