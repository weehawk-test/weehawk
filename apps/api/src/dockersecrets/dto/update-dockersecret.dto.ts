import { PartialType } from '@nestjs/swagger';
import { CreateDockersecretDto } from './create-dockersecret.dto';

export class UpdateDockersecretDto extends PartialType(CreateDockersecretDto) {}
