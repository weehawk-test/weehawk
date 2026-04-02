import type { ConfigService } from '@nestjs/config';
import type { ApplicationBuildRuntimeImages } from './executor-application-build';

export function getApplicationBuildRuntimeImages(
  configService: ConfigService,
): ApplicationBuildRuntimeImages {
  const fromEnv = configService.get<string>('WEEHAWK_DOCKER_SOCKET')?.trim();
  const dockerSocketHostPath = fromEnv
    ? fromEnv
    : process.platform === 'win32'
      ? '//var/run/docker.sock'
      : '/var/run/docker.sock';

  return {
    dockerSocketHostPath,
    builderCliImage:
      configService.get<string>('WEEHAWK_BUILDER_CLI_IMAGE')?.trim() || 'docker:24-cli',
  };
}
