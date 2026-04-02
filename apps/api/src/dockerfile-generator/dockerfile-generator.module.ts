import { Module } from '@nestjs/common';
import { DockerfileGeneratorService } from './dockerfile-generator.service';

@Module({
  providers: [DockerfileGeneratorService],
  exports: [DockerfileGeneratorService],
})
export class DockerfileGeneratorModule {}
