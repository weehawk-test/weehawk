import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GitIntegrationSettings } from './entities/git-integration.entity';
import { GitController } from './git.controller';
import { GitService } from './git.service';

@Module({
  imports: [TypeOrmModule.forFeature([GitIntegrationSettings])],
  controllers: [GitController],
  providers: [GitService],
  exports: [GitService],
})
export class GitModule {}
