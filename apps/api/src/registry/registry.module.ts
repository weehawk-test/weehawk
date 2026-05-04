import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RegistryController } from './registry.controller';
import { RegistryAccountsController } from './registry-accounts.controller';
import { RegistryService } from './registry.service';
import { RegistryAccount } from './entities/registry-account.entity';
import { OrganizationsModule } from '../organizations/organizations.module';
import { OrgRealtimeModule } from '../org-realtime/org-realtime.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([RegistryAccount]),
    OrganizationsModule,
    OrgRealtimeModule,
  ],
  controllers: [RegistryController, RegistryAccountsController],
  providers: [RegistryService],
  exports: [RegistryService],
})
export class RegistryModule {}
