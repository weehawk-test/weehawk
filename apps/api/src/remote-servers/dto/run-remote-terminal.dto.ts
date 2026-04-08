import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';

export class RunRemoteTerminalDto {
  @ApiProperty({ description: 'Bash command/script to run on remote server via SSH.' })
  @IsString()
  @MaxLength(4000)
  command!: string;
}
