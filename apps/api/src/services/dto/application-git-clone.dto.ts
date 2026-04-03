import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class ApplicationGitCloneDto {
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
      'HTTPS clone URL (e.g. from GitLab project page). Use when not picking by project id.',
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

  @ApiPropertyOptional({ example: '.', default: '.' })
  @IsOptional()
  @IsString()
  buildPath?: string;

  @ApiPropertyOptional({ example: 'Dockerfile' })
  @IsOptional()
  @IsString()
  dockerfilePath?: string;

  @ApiPropertyOptional({ example: 3000, default: 3000 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  containerPort?: number;

  @ApiPropertyOptional({ example: 8080 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  publishPort?: number;

  @ApiPropertyOptional({ example: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  replicas?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  variablesJson?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  networksJson?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  externalNetworks?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  stackNetworks?: string;
}
