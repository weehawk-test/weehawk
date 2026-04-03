import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Min } from 'class-validator';

/** Only clone into `app-source`; stack generation is a separate `generate-from-source` call. */
export class ApplicationGitCloneStageDto {
  @ApiPropertyOptional({
    description:
      'GitLab project id from GET /api/git/gitlab/projects (use this or httpUrlToRepo)',
    example: 12345,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  gitlabProjectId?: number;

  @ApiPropertyOptional({
    description:
      'HTTPS clone URL. Use when not picking by project id.',
    example: 'https://gitlab.com/group/project.git',
  })
  @IsOptional()
  @IsString()
  httpUrlToRepo?: string;

  @ApiPropertyOptional({
    description: 'Branch or tag to clone (default: GitLab default branch)',
    example: 'main',
  })
  @IsOptional()
  @IsString()
  branch?: string;
}
