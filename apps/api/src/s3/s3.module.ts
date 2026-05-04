import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OrganizationMembership } from '../organizations/entities/organization-membership.entity';
import { OrganizationsModule } from '../organizations/organizations.module';
import { RemoteServersModule } from '../remote-servers/remote-servers.module';
import { OrgRealtimeModule } from '../org-realtime/org-realtime.module';
import { S3Controller } from './s3.controller';
import { S3Service } from './s3.service';
import { S3Profile } from './entities/s3-profile.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([S3Profile, OrganizationMembership]),
    OrganizationsModule,
    RemoteServersModule,
    OrgRealtimeModule,
  ],
  controllers: [S3Controller],
  providers: [S3Service],
  exports: [S3Service],
})
export class S3Module {}
