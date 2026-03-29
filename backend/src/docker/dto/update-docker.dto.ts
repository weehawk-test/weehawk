import { PartialType } from '@nestjs/swagger';
import { CreateDockerDto } from './create-docker.dto';

export class UpdateDockerDto extends PartialType(CreateDockerDto) {}
