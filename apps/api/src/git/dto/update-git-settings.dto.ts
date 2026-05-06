import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

/** Partial update: omit a field to leave unchanged; send empty string to clear a secret or optional value. */
export class UpdateGitSettingsDto {
  @IsOptional()
  @IsString()
  @MaxLength(40)
  accountPublicId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  accountName?: string;

  @IsOptional()
  @IsBoolean()
  createNewAccount?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  githubAppId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  githubClientId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  githubAppSlug?: string;

  @IsOptional()
  @IsString()
  githubClientSecret?: string;

  @IsOptional()
  @IsString()
  githubPrivateKey?: string;

  @IsOptional()
  @IsString()
  githubWebhookSecret?: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  gitlabBaseUrl?: string;

  @IsOptional()
  @IsString()
  gitlabGroupAccessToken?: string;
}
