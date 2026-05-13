import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  Matches,
  ValidateNested,
  ValidateIf,
} from 'class-validator';
import { composeType } from '../entities/composeType.enum';
import { ServiceTraefikRouteDto } from './service-traefik-route.dto';

export class CreateServiceDto {
  @ApiProperty({ example: 'frontend', maxLength: 50 })
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  name!: string;

  @ApiProperty({
    example: 'weehawk-app',
    maxLength: 100,
    description:
      'Lowercase, numbers, and single dashes. Must start/end with a letter.',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  @Matches(/^[a-z](?!.*--)[a-z0-9-]*[a-z]$/, {
    message:
      'appName must be lowercase, start and end with a letter, and cannot contain consecutive dashes (--).',
  })
  appName!: string;

  @ApiProperty({ example: composeType.COMPOSE, enum: composeType })
  @IsEnum(composeType)
  composeType!: composeType;

  @ApiProperty({
    example: 'This service handles the web traffic',
    required: false,
  })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({
    example: 'version: "3.8"\nservices:\n  web:\n    image: nginx',
  })
  @IsString()
  dockerConfig!: string;

  @ApiProperty({ example: 'PORT=3000\nNODE_ENV=production', required: false })
  @IsString()
  @IsOptional()
  env?: string;

  @ApiProperty({ example: ['app.example.com'], required: false })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  domains?: string[];

  @ApiProperty({ type: [ServiceTraefikRouteDto], required: false })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ServiceTraefikRouteDto)
  traefikRoutes?: ServiceTraefikRouteDto[];

  @ApiProperty({ example: 1, description: 'ID of the parent project' })
  @IsNumber()
  @IsNotEmpty()
  projectId!: number;

  @ApiProperty({ required: false, default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiProperty({
    required: false,
    nullable: true,
    description:
      'When set, Docker commands for this service run on that host via SSH (DOCKER_HOST=ssh://…).',
  })
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsInt()
  remoteServerId?: number | null;

  @ApiProperty({
    required: false,
    nullable: true,
    description:
      'Optional: SSH host used only for `docker build` on Swarm application services (must be a build-role remote server). Deploy uses remoteServerId.',
  })
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsInt()
  buildRemoteServerId?: number | null;

  @ApiProperty({
    required: false,
    default: false,
    description:
      'Swarm application: when true, build on this server’s Docker (API host) even if deploy uses a remote host. Requires registry.pushImage / registry image so the remote can pull.',
  })
  @IsOptional()
  @IsBoolean()
  buildOnLocalDockerHost?: boolean;

  @ApiProperty({
    required: false,
    nullable: true,
    description:
      'Swarm application: full image ref for build+push (e.g. docker.io/myorg/app:latest). Requires `docker login` on the API host (Registry page). Stack deploy then pulls on the deploy host.',
  })
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsString()
  @MaxLength(512)
  registryPushImage?: string | null;

  @ApiProperty({
    required: false,
    default: false,
    description: 'Enable auto-deploy on git push to the configured branch.',
  })
  @IsOptional()
  @IsBoolean()
  autoDeployEnabled?: boolean;

  @ApiProperty({
    required: false,
    default: 'main',
    description: 'Branch that triggers auto-deploy.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  autoDeployBranch?: string;

  @ApiProperty({
    required: false,
    nullable: true,
    description: 'Git provider: "github" or "gitlab".',
  })
  @IsOptional()
  @IsString()
  @MaxLength(24)
  autoDeployGitProvider?: string | null;

  @ApiProperty({
    required: false,
    nullable: true,
    description:
      'Provider-specific repo id (e.g. "installationId:owner/repo" for GitHub, project id for GitLab).',
  })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  autoDeployRepoId?: string | null;
}
