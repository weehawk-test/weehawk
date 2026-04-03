import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class ExchangeGithubManifestDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  code!: string;
}
