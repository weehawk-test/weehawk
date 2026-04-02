import { randomBytes } from 'crypto';
import type { EventEmitter } from 'events';
import { resolveEffectiveDockerfileRel } from '../services/weehawk-build-paths';
import { normalizeHostPathForDockerBind, spawnDocker } from './executor-docker';

export type ApplicationBuildRuntimeImages = {
  dockerSocketHostPath: string;
  builderCliImage: string;
};

/**
 * Ephemeral builder: `docker run --rm` with socket + context mount so `docker build`
 * never installs toolchains on the host (only the Docker CLI is used to orchestrate).
 * Dockerfile-first: no Cloud Native Buildpacks.
 */
export async function runIsolatedApplicationBuild(
  images: ApplicationBuildRuntimeImages,
  params: {
    serviceId: number;
    fullContextHostPath: string;
    dockerfilePathFromConfig: string;
    imageName: string;
    execEnv: NodeJS.ProcessEnv;
    deployLogEmitter?: EventEmitter;
  },
): Promise<{ stdout: string; stderr: string }> {
  const socketHost = images.dockerSocketHostPath;
  const hostContext = normalizeHostPathForDockerBind(params.fullContextHostPath);
  const containerName = `weehawk-build-${params.serviceId}-${randomBytes(6).toString('hex')}`;

  const { relativePath: dockerfileRel } = await resolveEffectiveDockerfileRel(
    params.fullContextHostPath,
    params.dockerfilePathFromConfig,
  );
  const dockerfileInContainer = `/src/${dockerfileRel}`.replace(/\/+/g, '/');
  const innerDockerArgs = [
    'build',
    '-f',
    dockerfileInContainer,
    '-t',
    params.imageName,
    '/src',
  ];
  const runArgs = [
    'run',
    '--rm',
    '--name',
    containerName,
    '-v',
    `${socketHost}:/var/run/docker.sock`,
    '-v',
    `${hostContext}:/src`,
    '-w',
    '/src',
    images.builderCliImage,
    ...innerDockerArgs,
  ];
  return await spawnDocker(runArgs, {
    env: params.execEnv,
    deployLogEmitter: params.deployLogEmitter,
  });
}
