import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { GitIntegrationSettings } from './entities/git-integration.entity';
import { GitController } from './git.controller';
import { GitService } from './git.service';

@Module({
  imports: [TypeOrmModule.forFeature([GitIntegrationSettings]), AuthModule],
  controllers: [GitController],
  providers: [GitService],
  exports: [GitService],
})
export class GitModule {}
