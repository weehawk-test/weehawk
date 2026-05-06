import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateGitAccountDto {
  @IsIn(['github', 'gitlab'])
  provider!: 'github' | 'gitlab';

  @IsString()
  @MaxLength(120)
  accountName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  gitlabBaseUrl?: string;

  @IsOptional()
  @IsString()
  gitlabGroupAccessToken?: string;
}
