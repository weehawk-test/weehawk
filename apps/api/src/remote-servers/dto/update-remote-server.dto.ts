import { PartialType } from '@nestjs/mapped-types';
import { CreateRemoteServerDto } from './create-remote-server.dto';

export class UpdateRemoteServerDto extends PartialType(CreateRemoteServerDto) {}
