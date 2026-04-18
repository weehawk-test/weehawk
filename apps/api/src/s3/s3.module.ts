import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RemoteServersModule } from '../remote-servers/remote-servers.module';
import { S3Controller } from './s3.controller';
import { S3Service } from './s3.service';
import { S3Profile } from './entities/s3-profile.entity';

@Module({
  imports: [TypeOrmModule.forFeature([S3Profile]), RemoteServersModule],
  controllers: [S3Controller],
  providers: [S3Service],
  exports: [S3Service],
})
export class S3Module {}
