import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { RegistryController } from './registry.controller';
import { RegistryAccountsController } from './registry-accounts.controller';
import { RegistryService } from './registry.service';
import { RegistryAccount } from './entities/registry-account.entity';

@Module({
  imports: [TypeOrmModule.forFeature([RegistryAccount]), AuthModule],
  controllers: [RegistryController, RegistryAccountsController],
  providers: [RegistryService],
  exports: [RegistryService],
})
export class RegistryModule {}
