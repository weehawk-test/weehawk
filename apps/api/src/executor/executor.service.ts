import {
  BadRequestException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  forwardRef,
  Inject,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { gzipSync } from 'zlib';
import * as fs from 'fs/promises';
import * as path from 'path';
import { ServicesService } from '../services/services.service';
import { composeType } from '../services/entities/composeType.enum';
import { Service } from '../services/entities/service.entity';
import type { ServiceVolumesResponseDto } from '../services/dto/service-volume-mount.dto';
import { getServiceDeploymentDir, toSafePathSegment } from '../services/deployment-paths';
import { resolveEffectiveDockerfileRel } from '../services/weehawk-build-paths';
import { maybeRemoveApplicationSourceAfterDeploy } from './executor-app-source';
import {
  firstComposeServiceName,
  firstImageRefFromComposeYaml,
  parseConfigHeaderValue,
  parseEnv,
} from './executor-compose-parse';
import { removeDeploymentFolder } from './executor-deployment-fs';
import { emitDeployLog, formatExecError, stderrIndicatesDockerFailure } from './executor-docker';
import type { ExecuteDeployOptions } from './executor-types';
import { isSwarmStackService } from './executor-swarm';
import { flattenVolumesFromComposeJson } from './executor-volumes';
import { runStructuredDatabaseBackup } from './executor-structured-db-backup';
import {
  runStructuredDatabaseImport,
  type StructuredDbImportDocker,
} from './executor-structured-db-import';
import {
  assertSafeComposeService,
  type DatabaseBackupConfig,
} from '../backup/database-backup.types';
import {
  RemoteServersService,
  WEEHAWK_REMOTE_DEPLOYMENTS_BASE,
} from '../remote-servers/remote-servers.service';
import { RegistryService } from '../registry/registry.service';

export type { ExecuteDeployOptions } from './executor-types';

/** Swarm stacks are deployed over SSH; without a deploy host, do not call local `docker` (avoids Windows Docker Desktop / npipe errors on the API PC). */
const SWARM_NEEDS_DEPLOY_HOST_MESSAGE =
  'Configure a deploy SSH server for this service (Remote / deploy host) first.';

const COMPOSE_NEEDS_DEPLOY_HOST_MESSAGE =
  'No deploy host is set for this compose service. Choose a remote Deploy server under Remote Docker host, save, then try again.';

function pickDockerSshEnv(
  env: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv | undefined {
  if (!env.DOCKER_HOST) {
    return undefined;
  }
  const o: NodeJS.ProcessEnv = { DOCKER_HOST: env.DOCKER_HOST };
  if (env.DOCKER_SSH_OPTS) {
    o.DOCKER_SSH_OPTS = env.DOCKER_SSH_OPTS;
  }
  return o;
}

@Injectable()
export class ExecutorService {
  constructor(
    @Inject(forwardRef(() => ServicesService))
    private readonly servicesService: ServicesService,
    private readonly configService: ConfigService,
    private readonly remoteServersService: RemoteServersService,
    private readonly registryService: RegistryService,
  ) {}

  private async getBaseProcessEnvForService(
    service: Service,
  ): Promise<NodeJS.ProcessEnv> {
    const envVars = parseEnv(service.env || '');
    return { ...process.env, ...envVars };
  }

  private async getProcessEnvForService(
    service: Service,
  ): Promise<NodeJS.ProcessEnv> {
    const base = await this.getBaseProcessEnvForService(service);
    const ids = await this.servicesService.getDockerSshTargetIds(service.id);
    const projectUserId: number | null = null;
    return this.remoteServersService.mergeDockerHostEnvForDeployIds(
      base,
      ids.remoteServerId,
      projectUserId,
    );
  }

  /**
   * @param mode `deploy` = build then up (compose) or stack deploy; `reload` = compose up --no-build or stack deploy;
   * `redeploy` = stop compose project then up --build, or stack deploy + forced rolling restart on every service.
   */
  async execute(
    id: number,
    mode: 'deploy' | 'reload' | 'redeploy' = 'deploy',
    options?: ExecuteDeployOptions,
  ) {
    const service = await this.servicesService.findOne(id);
    const sshTargets = await this.servicesService.getDockerSshTargetIds(service.id);
    const projectUserId: number | null = null;
    const rawConfig = (service.dockerConfig || '').trim();
    if (!rawConfig) {
      if (service.composeType === composeType.DATABASES) {
        return {
          success: false,
          output:
            'No stack file yet. Configure Postgres (or paste YAML), save, then deploy.',
        };
      }
    }

    if (sshTargets.remoteServerId == null) {
      return {
        success: false,
        output:
          'No deploy host is set for this service. Open the service → Remote Docker host, choose a remote Deploy server, save, then deploy again. The machine running Weehawk is for image builds only; running stacks and compose projects must use a remote Deploy host.',
      };
    }

    const deployDir = getServiceDeploymentDir(
      service.appName,
      undefined,
    );

    await fs.mkdir(deployDir, { recursive: true });
    const composeFile = path.join(deployDir, 'docker-compose.yml');

    const finalConfig = service.dockerConfig.replace(
      /\${APP_NAME}/g,
      service.appName,
    );
    await fs.writeFile(composeFile, finalConfig);
    if (sshTargets.remoteServerId != null && !isSwarmStackService(service)) {
      await this.remoteServersService.mirrorDockerComposeToRemotePersistent(
        sshTargets.remoteServerId,
        projectUserId,
        {
          localComposeAbsolutePath: composeFile,
          projectName: service.appName || 'service',
        },
      );
    }

    const execOpts = {
      cwd: deployDir,
      env: await this.getProcessEnvForService(service),
    };
    const deployLogEmitter = options?.deployLogEmitter;
    const emitChunk = (chunk: string) => emitDeployLog(deployLogEmitter, chunk);
    try {
      if (isSwarmStackService(service)) {
        let buildLogPrefix = '';
        if (service.composeType === composeType.APPLICATION) {
          const deployMode =
            parseConfigHeaderValue(rawConfig, 'deployMode')?.toLowerCase() || 'source';
          const sourceDir = parseConfigHeaderValue(rawConfig, 'sourceDir') || 'app-source';
          const buildPath = parseConfigHeaderValue(rawConfig, 'buildPath') || '.';
          const dockerfilePath =
            parseConfigHeaderValue(rawConfig, 'dockerfilePath') || 'Dockerfile';
          const registryPush = parseConfigHeaderValue(rawConfig, 'registry.pushImage')?.trim();
          const defaultTag = `${service.appName}:latest`;
          const imageTag = registryPush?.length ? registryPush : defaultTag;
          const sourceRoot = path.join(deployDir, sourceDir);
          const fullContext = path.join(deployDir, sourceDir, buildPath);
          const sourceRootExists = await fs
            .access(sourceRoot)
            .then(() => true)
            .catch(() => false);
          if (deployMode !== 'image' && sourceRootExists) {
            await fs.access(fullContext).catch(() => {
              throw new InternalServerErrorException(
                `Application build path not found: "${buildPath}" under ${sourceDir}.`,
              );
            });
            const { relativePath: dockerfileRel } = await resolveEffectiveDockerfileRel(
              fullContext,
              dockerfilePath,
            );
            const fullDockerfile = path.join(fullContext, ...dockerfileRel.split('/'));
            await fs.access(fullDockerfile).catch(() => {
              throw new InternalServerErrorException(
                `Dockerfile not found for build: "${dockerfileRel}" under build context.`,
              );
            });
            const sshIds = await this.servicesService.getDockerSshTargetIds(service.id);
            const buildBase = await this.getBaseProcessEnvForService(service);
            const projectUserId: number | null = null;
            const buildEnv = await this.remoteServersService.mergeDockerHostEnvForBuildIds(
              buildBase,
              {
                buildRemoteServerId: sshIds.buildRemoteServerId,
                remoteServerId: sshIds.remoteServerId,
                buildOnLocalDockerHost: sshIds.buildOnLocalDockerHost,
              },
              projectUserId,
            );
            const useRemoteDockerBuild = Boolean(pickDockerSshEnv(buildEnv));
            const buildRemoteServerId =
              sshIds.buildRemoteServerId ?? sshIds.remoteServerId;
            if (useRemoteDockerBuild) {
              if (buildRemoteServerId == null) {
                throw new InternalServerErrorException(
                  'Remote Docker build is enabled but no remote server id was resolved for this service.',
                );
              }
              const dockerfilePosix = dockerfileRel.split(/[/\\]/).join('/');
              emitChunk(`Building image on remote host #${buildRemoteServerId}…\n`);
              const buildResult = await this.remoteServersService.buildImageUsingDockerodeSsh(
                buildRemoteServerId,
                {
                  contextPath: fullContext,
                  dockerfilePosix,
                  tag: imageTag,
                },
                projectUserId,
              );
              buildLogPrefix = buildResult.output ? `${buildResult.output}\n` : '';
              if (buildLogPrefix) emitChunk(buildLogPrefix);
            } else {
              if (mode === 'deploy') {
                await removeDeploymentFolder(deployDir);
              }
              return {
                success: false,
                output:
                  'Configure a remote Build or Deploy SSH host for this service so `docker build` runs on that machine. The Weehawk API host does not run Docker.',
              };
            }
            if (registryPush?.trim()) {
              if (!useRemoteDockerBuild || buildRemoteServerId == null) {
                if (mode === 'deploy') {
                  await removeDeploymentFolder(deployDir);
                }
                return {
                  success: false,
                  output:
                    'Registry push requires a remote Docker build host. Configure a Build or Deploy SSH server, then deploy again.',
                };
              }
              emitChunk(`Pushing image "${registryPush}" on remote host…\n`);
              const pushAuth =
                await this.registryService.getRegistryAuthConfigForImageRef(registryPush);
              try {
                const pushResult = await this.remoteServersService.pushImageUsingDockerodeSsh(
                  buildRemoteServerId,
                  {
                    imageRef: registryPush,
                    auth: pushAuth,
                  },
                  projectUserId,
                );
                if (pushResult.output) {
                  const pushChunk = pushResult.output + '\n';
                  buildLogPrefix = (buildLogPrefix || '') + pushChunk;
                  emitChunk(pushChunk);
                }
              } catch (pushErr) {
                if (mode === 'deploy') {
                  await removeDeploymentFolder(deployDir);
                }
                if (pushErr instanceof HttpException) {
                  return { success: false, output: pushErr.message };
                }
                return {
                  success: false,
                  output:
                    `Docker registry push failed for "${registryPush}". Check saved registry credentials for this host and project permissions.\n\n` +
                    formatExecError(pushErr),
                };
              }
            }
          }
          /* If source was removed after a previous deploy, skip build and rely on existing local image + stack deploy. */
        }
        const authImageRef =
          parseConfigHeaderValue(rawConfig, 'registry.pushImage')?.trim() ||
          firstImageRefFromComposeYaml(finalConfig) ||
          '';
        let stackDeployEnv = execOpts.env;
        let stackRegistryCleanup: (() => Promise<void>) | undefined;
        if (authImageRef.trim()) {
          const merged = await this.registryService.mergePushEnvForImageRef(
            authImageRef,
            execOpts.env,
          );
          stackDeployEnv = merged.env;
          stackRegistryCleanup = merged.cleanup;
        }
        const remoteDeployId = sshTargets.remoteServerId;
        if (remoteDeployId != null) {
          let localDockerConfigDir: string | undefined;
          const dockerCfg = stackDeployEnv.DOCKER_CONFIG;
          if (typeof dockerCfg === 'string' && dockerCfg.trim().length > 0) {
            localDockerConfigDir = dockerCfg.trim();
          }
          try {
            emitChunk(`Deploying stack "${service.appName}" on remote host #${remoteDeployId}…\n`);
            const r = await this.remoteServersService.stackDeployViaSsh(
              remoteDeployId,
              projectUserId,
              {
                composeYaml: finalConfig,
                stackName: service.appName,
                localDockerConfigDir,
                onChunk: deployLogEmitter ? emitChunk : undefined,
                deployEnv: parseEnv(service.env || ''),
              },
            );
            let out = [buildLogPrefix, r.stdout, r.stderr].filter((s) => s && s.trim()).join('\n');
            let err = [buildLogPrefix, r.stderr]
              .filter((s) => s && String(s).trim())
              .join('\n');

            if (mode === 'redeploy') {
              emitChunk('Force-updating services for rolling restart…\n');
              const forced = await this.remoteServersService.forceRollingRestartStackViaSsh(
                remoteDeployId,
                projectUserId,
                service.appName,
                deployLogEmitter ? emitChunk : undefined,
              );
              out = [out, forced.output].filter(Boolean).join('\n');
              err += forced.stderr;
            }

            const stderrIndicatesFailure = stderrIndicatesDockerFailure(err);
            const success = !stderrIndicatesFailure;
            if (success) {
              if (service.composeType === composeType.APPLICATION) {
                await this.maybeMirrorApplicationSourceForOnHostRedeploy(
                  service,
                  deployDir,
                  remoteDeployId,
                );
              }
              await maybeRemoveApplicationSourceAfterDeploy(
                service,
                deployDir,
                this.configService,
              );
            }
            return { success, output: out };
          } finally {
            await stackRegistryCleanup?.();
          }
        }

        throw new InternalServerErrorException(
          'Swarm deploy requires a deploy host; this should have been validated earlier.',
        );
      }

      const remoteComposeId = sshTargets.remoteServerId!;
      const deployEnvCompose = parseEnv(service.env || '');
      if (mode === 'redeploy') {
        try {
          await this.remoteServersService.composeInPersistentDeploymentViaSsh(
            remoteComposeId,
            projectUserId,
            {
              projectName: service.appName,
              composeArgvTail: ['stop'],
              deployEnv: deployEnvCompose,
              onChunk: deployLogEmitter ? emitChunk : undefined,
            },
          );
        } catch {
          /* already stopped or nothing to stop */
        }
      }
      const composeTail =
        mode === 'deploy' || mode === 'redeploy'
          ? (['up', '-d', '--build'] as const)
          : (['up', '-d', '--no-build'] as const);
      const cr = await this.remoteServersService.composeInPersistentDeploymentViaSsh(
        remoteComposeId,
        projectUserId,
        {
          projectName: service.appName,
          composeArgvTail: [...composeTail],
          deployEnv: deployEnvCompose,
          onChunk: deployLogEmitter ? emitChunk : undefined,
        },
      );
      const out = [cr.stdout, cr.stderr].filter((s) => s && s.trim()).join('\n');
      const err = cr.stderr ?? '';
      const stderrIndicatesFailure = stderrIndicatesDockerFailure(err);
      const success = !stderrIndicatesFailure;
      if (success) {
        await maybeRemoveApplicationSourceAfterDeploy(service, deployDir, this.configService);
      }
      return { success, output: out };
    } catch (error) {
      if (mode === 'deploy') {
        await removeDeploymentFolder(deployDir);
      }
      if (error instanceof HttpException) {
        const res = error.getResponse();
        let msg: string;
        if (typeof res === 'string') {
          msg = res;
        } else if (res && typeof res === 'object' && 'message' in res) {
          const m = (res as { message?: string | string[] }).message;
          msg = Array.isArray(m) ? m.join('\n') : String(m ?? error.message);
        } else {
          msg = error.message;
        }
        return { success: false, output: msg };
      }
      return { success: false, output: formatExecError(error) };
    }
  }

  /**
   * Copies the saved compose bundle to the deploy host under `/opt/weehawk-deployments/<app>/`
   * (and Swarm registry/env sidecar files) without running `docker stack deploy` / compose up —
   * so on-host redeploy webhooks work before the first full deploy from Weehawk.
   */
  async syncRemoteDeploymentMirror(
    id: number,
    _actingUserId: number,
  ): Promise<{ ok: boolean }> {
    const service = await this.servicesService.findOne(id);
    const sshTargets = await this.servicesService.getDockerSshTargetIds(service.id);
    const projectUserId: number | null = null;
    const remoteId = sshTargets.remoteServerId;
    if (remoteId == null) {
      throw new BadRequestException(
        'This service has no deploy host selected. Choose a remote Docker host for this service.',
      );
    }
    const rawConfig = (service.dockerConfig || '').trim();
    if (!rawConfig) {
      if (service.composeType === composeType.DATABASES) {
        throw new BadRequestException(
          'No stack file yet. Configure the database stack (or paste YAML), save, then try again.',
        );
      }
      throw new BadRequestException(
        'No compose YAML saved for this service yet. Save the service configuration first.',
      );
    }
    const deployDir = getServiceDeploymentDir(
      service.appName,
      undefined,
    );
    await fs.mkdir(deployDir, { recursive: true });
    const composeFile = path.join(deployDir, 'docker-compose.yml');
    const finalConfig = service.dockerConfig.replace(
      /\${APP_NAME}/g,
      service.appName,
    );
    if (!finalConfig.trim()) {
      throw new BadRequestException(
        'Compose content is empty after resolving ${APP_NAME}. Fix the service YAML and save.',
      );
    }
    await fs.writeFile(composeFile, finalConfig);

    if (!isSwarmStackService(service)) {
      await this.remoteServersService.mirrorDockerComposeToRemotePersistent(
        remoteId,
        projectUserId,
        {
          localComposeAbsolutePath: composeFile,
          projectName: service.appName || 'service',
        },
      );
      return { ok: true };
    }

    const authImageRef =
      parseConfigHeaderValue(rawConfig, 'registry.pushImage')?.trim() ||
      firstImageRefFromComposeYaml(finalConfig) ||
      '';
    const deployEnv = parseEnv(service.env || '');
    const execEnv = await this.getProcessEnvForService(service);
    if (authImageRef.trim()) {
      const merged = await this.registryService.mergePushEnvForImageRef(
        authImageRef,
        execEnv,
      );
      let localDockerConfigDir: string | undefined;
      const dockerCfg = merged.env.DOCKER_CONFIG;
      if (typeof dockerCfg === 'string' && dockerCfg.trim().length > 0) {
        localDockerConfigDir = dockerCfg.trim();
      }
      try {
        await this.remoteServersService.writePersistentDeploymentMirror(
          remoteId,
          projectUserId,
          {
            stackName: service.appName || 'service',
            composeYaml: finalConfig,
            deployEnv,
            localDockerConfigDir,
          },
        );
      } finally {
        await merged.cleanup();
      }
    } else {
      await this.remoteServersService.writePersistentDeploymentMirror(
        remoteId,
        projectUserId,
        {
          stackName: service.appName || 'service',
          composeYaml: finalConfig,
          deployEnv,
        },
      );
    }
    if (isSwarmStackService(service) && service.composeType === composeType.APPLICATION) {
      await this.maybeMirrorApplicationSourceForOnHostRedeploy(service, deployDir, remoteId);
    }
    return { ok: true };
  }

  /**
   * Copies `app-source/` to the deploy host mirror so on-host webhooks can `docker build` without the API running.
   */
  private async maybeMirrorApplicationSourceForOnHostRedeploy(
    service: Service,
    deployDir: string,
    remoteId: number,
  ): Promise<void> {
    const raw = (service.dockerConfig || '').trim();
    const deployMode = parseConfigHeaderValue(raw, 'deployMode')?.toLowerCase() || 'source';
    if (deployMode === 'image') {
      return;
    }
    const sourceDirName = parseConfigHeaderValue(raw, 'sourceDir') || 'app-source';
    const localSourceRoot = path.join(deployDir, sourceDirName);
    try {
      await fs.access(localSourceRoot);
    } catch {
      return;
    }
    const persist = `${WEEHAWK_REMOTE_DEPLOYMENTS_BASE}/${toSafePathSegment(service.appName || 'service')}`;
    const remoteTarget = `${persist}/${sourceDirName.replace(/\\/g, '/')}`;
    await this.remoteServersService.mirrorLocalDirectoryToRemoteDeployment(remoteId, null, {
      localRootAbsolute: localSourceRoot,
      remoteDirAbsolute: remoteTarget,
    });
  }

  /** Start stopped containers; compose tries `start` then `up -d --no-build`. Stack: stack deploy. */
  async startContainers(id: number) {
    const service = await this.servicesService.findOne(id);
    const sshIds = await this.servicesService.getDockerSshTargetIds(service.id);

    if (isSwarmStackService(service)) {
      return await this.execute(id, 'reload');
    }

    if (sshIds.remoteServerId == null) {
      throw new BadRequestException(
        'No deploy host is set for this service. Choose a remote Deploy server under Remote Docker host, save, then start again.',
      );
    }

    const deployDir = getServiceDeploymentDir(
      service.appName,
      undefined,
    );
    const composeFile = path.join(deployDir, 'docker-compose.yml');

    await fs.mkdir(deployDir, { recursive: true });
    const finalConfig = service.dockerConfig.replace(
      /\${APP_NAME}/g,
      service.appName,
    );
    await fs.writeFile(composeFile, finalConfig);
    const projectUserId: number | null = null;
    await this.remoteServersService.mirrorDockerComposeToRemotePersistent(
      sshIds.remoteServerId,
      projectUserId,
      { localComposeAbsolutePath: composeFile, projectName: service.appName || 'service' },
    );
    const deployEnv = parseEnv(service.env || '');
    try {
      const r = await this.remoteServersService.composeInPersistentDeploymentViaSsh(
        sshIds.remoteServerId,
        projectUserId,
        {
          projectName: service.appName,
          composeArgvTail: ['start'],
          deployEnv,
        },
      );
      return { success: true, output: [r.stdout, r.stderr].filter((s) => s?.trim()).join('\n') };
    } catch {
      const r = await this.remoteServersService.composeInPersistentDeploymentViaSsh(
        sshIds.remoteServerId,
        projectUserId,
        {
          projectName: service.appName,
          composeArgvTail: ['up', '-d', '--no-build'],
          deployEnv,
        },
      );
      return { success: true, output: [r.stdout, r.stderr].filter((s) => s?.trim()).join('\n') };
    }
  }

  async getRuntimeStatus(id: number): Promise<{ running: boolean }> {
    const service = await this.servicesService.findOne(id);
    const sshIds = await this.servicesService.getDockerSshTargetIds(service.id);
    const projectUserId: number | null = null;
    const deployDir = getServiceDeploymentDir(
      service.appName,
      undefined,
    );
    const composeFile = path.join(deployDir, 'docker-compose.yml');

    try {
      if (isSwarmStackService(service)) {
        let stdout: string;
        if (sshIds.remoteServerId != null) {
          const stackQ = service.appName.replace(/'/g, `'\\''`);
          try {
            const r = await this.remoteServersService.execDockerCliOnRemoteViaSsh(
              sshIds.remoteServerId,
              projectUserId,
              `docker stack services '${stackQ}' --format "{{.Replicas}}" 2>/dev/null || true`,
            );
            stdout = r.stdout;
          } catch {
            return { running: false };
          }
        } else {
          return { running: false };
        }
        const running = stdout.split(/\r?\n/).some((line) => {
          const m = line.trim().match(/^(\d+)\//);
          return m !== null && parseInt(m[1], 10) > 0;
        });
        return { running };
      }

      if (sshIds.remoteServerId == null) {
        return { running: false };
      }

      const exists = await fs
        .access(composeFile)
        .then(() => true)
        .catch(() => false);
      if (!exists) return { running: false };

      const deployEnv = parseEnv(service.env || '');
      const r = await this.remoteServersService.composeInPersistentDeploymentViaSsh(
        sshIds.remoteServerId,
        projectUserId,
        {
          projectName: service.appName,
          composeArgvTail: ['ps', '--status', 'running', '-q'],
          deployEnv,
        },
      );
      return { running: r.stdout.trim().length > 0 };
    } catch {
      return { running: false };
    }
  }

  /**
   * Resolves a running container ID for docker exec (compose project or Swarm stack task).
   * @param composeServiceKey Optional exact `services:` key (e.g. database backup `composeService`).
   *   When omitted, uses the first service name in the compose YAML (legacy behavior).
   */
  async getExecContainerId(
    id: number,
    composeServiceKey?: string,
  ): Promise<{ id: string } | { error: string }> {
    let service: Service;
    try {
      service = await this.servicesService.findOne(id);
    } catch (e) {
      if (e instanceof NotFoundException) {
        return { error: 'Service not found.' };
      }
      throw e;
    }

    const deployDir = getServiceDeploymentDir(
      service.appName,
      undefined,
    );
    const composeFile = path.join(deployDir, 'docker-compose.yml');
    const sshIds = await this.servicesService.getDockerSshTargetIds(service.id);
    const projectUserId: number | null = null;
    let key: string;
    if (composeServiceKey !== undefined && composeServiceKey.trim() !== '') {
      try {
        key = assertSafeComposeService(composeServiceKey);
      } catch {
        return { error: 'Invalid compose service name.' };
      }
    } else {
      key = firstComposeServiceName(service.dockerConfig || '');
    }

    try {
      if (isSwarmStackService(service)) {
        let stdout: string;
        if (sshIds.remoteServerId != null) {
          const nameFilter = `${service.appName}_${key}`.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
          try {
            const r = await this.remoteServersService.execDockerCliOnRemoteViaSsh(
              sshIds.remoteServerId,
              projectUserId,
              `docker ps -q -f "name=${nameFilter}" -f "status=running" 2>/dev/null || true`,
            );
            stdout = r.stdout;
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            return { error: msg || 'Could not resolve container.' };
          }
        } else {
          return { error: SWARM_NEEDS_DEPLOY_HOST_MESSAGE };
        }
        const cid = stdout.trim().split(/\r?\n/).filter(Boolean)[0];
        if (!cid) {
          return {
            error:
              'No running container for this stack service. Start the service on the host first.',
          };
        }
        return { id: cid };
      }

      const exists = await fs
        .access(composeFile)
        .then(() => true)
        .catch(() => false);
      if (!exists) {
        return {
          error:
            'Compose file not found on the server. Deploy this service first.',
        };
      }

      if (sshIds.remoteServerId == null) {
        return { error: COMPOSE_NEEDS_DEPLOY_HOST_MESSAGE };
      }

      const deployEnv = parseEnv(service.env || '');
      const pr = await this.remoteServersService.composeInPersistentDeploymentViaSsh(
        sshIds.remoteServerId,
        projectUserId,
        {
          projectName: service.appName,
          composeArgvTail: ['ps', '-q', '--status', 'running', key],
          deployEnv,
        },
      );
      const cid = pr.stdout.trim().split(/\r?\n/).filter(Boolean)[0];
      if (!cid) {
        return {
          error:
            'No running container for this compose service. Start the service on the host first.',
        };
      }
      return { id: cid };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { error: msg || 'Could not resolve container.' };
    }
  }

  async stopAndRemove(id: number) {
    const service = await this.servicesService.findOne(id);
    const sshIds = await this.servicesService.getDockerSshTargetIds(service.id);
    const projectUserId: number | null = null;
    const deployDir = getServiceDeploymentDir(
      service.appName,
      undefined,
    );
    const composeFile = path.join(deployDir, 'docker-compose.yml');

    try {
      if (isSwarmStackService(service)) {
        if (sshIds.remoteServerId != null) {
          await this.remoteServersService.stackRmViaSsh(
            sshIds.remoteServerId,
            projectUserId,
            service.appName,
          );
          console.log(`Stack ${service.appName} removed from Swarm.`);
        } else {
          console.warn(
            `stopAndRemove: Swarm service "${service.appName}" has no deploy host; skipped stack removal.`,
          );
        }
      } else if (sshIds.remoteServerId != null) {
        const fileExists = await fs
          .access(composeFile)
          .then(() => true)
          .catch(() => false);
        if (fileExists) {
          const deployEnv = parseEnv(service.env || '');
          await this.remoteServersService.composeInPersistentDeploymentViaSsh(
            sshIds.remoteServerId,
            projectUserId,
            {
              projectName: service.appName,
              composeArgvTail: ['down', '-v'],
              deployEnv,
            },
          );
          console.log(
            `Compose project ${service.appName} stopped and volumes removed on deploy host.`,
          );
        }
      }
    } catch (error) {
      console.error(`Clean stop failed: ${error.message}`);
    } finally {
      await removeDeploymentFolder(deployDir);
    }
  }

  /**
   * Declared volume/bind mounts from the service compose file (`docker compose config --format json`).
   */
  async getServiceVolumeMounts(id: number): Promise<ServiceVolumesResponseDto> {
    const service = await this.servicesService.findOne(id);
    const raw = (service.dockerConfig || '').trim();
    if (!raw) {
      return { items: [], error: 'No compose configuration on this service.' };
    }

    const deployDir = getServiceDeploymentDir(
      service.appName,
      undefined,
    );
    const composeFile = path.join(deployDir, 'docker-compose.yml');
    await fs.mkdir(deployDir, { recursive: true });
    const finalConfig = service.dockerConfig.replace(
      /\${APP_NAME}/g,
      service.appName,
    );
    await fs.writeFile(composeFile, finalConfig, 'utf8');
    const sshIds = await this.servicesService.getDockerSshTargetIds(service.id);
    const projectUserId: number | null = null;
    if (sshIds.remoteServerId == null) {
      return {
        items: [],
        error: COMPOSE_NEEDS_DEPLOY_HOST_MESSAGE,
      };
    }

    try {
      await this.remoteServersService.mirrorDockerComposeToRemotePersistent(
        sshIds.remoteServerId,
        projectUserId,
        { localComposeAbsolutePath: composeFile, projectName: service.appName || 'service' },
      );
      const deployEnv = parseEnv(service.env || '');
      const { stdout } = await this.remoteServersService.composeInPersistentDeploymentViaSsh(
        sshIds.remoteServerId,
        projectUserId,
        {
          projectName: service.appName,
          composeArgvTail: ['config', '--format', 'json'],
          deployEnv,
        },
      );
      const cfg = JSON.parse(stdout) as Record<string, unknown>;
      const items = flattenVolumesFromComposeJson(cfg);
      return { items };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return {
        items: [],
        error: `Could not parse compose volumes on the deploy host (is Docker available and the YAML valid?): ${msg}`,
      };
    }
  }

  /**
   * Backup a named Docker volume to `destDir` as a .tar.gz (host path must be absolute).
   */
  async backupDatabaseStructured(
    serviceId: number,
    config: DatabaseBackupConfig,
    destDir: string,
  ): Promise<{ success: boolean; output: string; archiveBasename?: string }> {
    const service = await this.servicesService.findOne(serviceId);
    const deployDir = getServiceDeploymentDir(
      service.appName,
      undefined,
    );
    await fs.mkdir(deployDir, { recursive: true });
    const composeFile = path.join(deployDir, 'docker-compose.yml');
    const finalConfig = (service.dockerConfig || '').replace(
      /\$\{APP_NAME\}/g,
      service.appName,
    );
    await fs.writeFile(composeFile, finalConfig, 'utf8');

    const resolved = await this.getExecContainerId(
      serviceId,
      config.composeService,
    );
    if ('error' in resolved) {
      return { success: false, output: resolved.error };
    }

    const sshIds = await this.servicesService.getDockerSshTargetIds(serviceId);
    if (sshIds.remoteServerId == null) {
      return { success: false, output: COMPOSE_NEEDS_DEPLOY_HOST_MESSAGE };
    }
    const projectUserId: number | null = null;
    const runDocker = (argv: string[]) =>
      this.remoteServersService.execDockerArgvBinaryOnRemoteViaSsh(
        sshIds.remoteServerId!,
        projectUserId,
        argv,
      );
    return runStructuredDatabaseBackup(
      deployDir,
      config,
      destDir,
      service.appName,
      runDocker,
      resolved.id,
    );
  }

  async backupDockerVolume(
    volumeName: string,
    destDir: string,
    remoteServerId: number,
    projectUserId: number | null = null,
  ): Promise<{ success: boolean; output: string; archiveBasename?: string }> {
    try {
      const { data, stderr } =
        await this.remoteServersService.dockerNamedVolumeBackupArchiveFromRemote(
          remoteServerId,
          projectUserId,
          volumeName,
        );
      await fs.mkdir(destDir, { recursive: true });
      const safe = volumeName.trim();
      const archiveBasename = `vol-${safe}-${Date.now()}.tar.gz`;
      const fullPath = path.join(path.resolve(destDir), archiveBasename);
      await fs.writeFile(fullPath, data);
      const out = [stderr].filter((s) => s?.trim()).join('\n');
      return {
        success: true,
        output: [out, `Archive: ${fullPath}`].filter(Boolean).join('\n'),
        archiveBasename,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { success: false, output: msg };
    }
  }

  /** Restore DB from an uploaded archive (sql / custom / mongodump, etc.). */
  async importDatabaseStructured(
    serviceId: number,
    config: DatabaseBackupConfig,
    hostArchivePath: string,
  ): Promise<{ success: boolean; output: string }> {
    const service = await this.servicesService.findOne(serviceId);
    const deployDir = getServiceDeploymentDir(
      service.appName,
      undefined,
    );
    await fs.mkdir(deployDir, { recursive: true });
    const composeFile = path.join(deployDir, 'docker-compose.yml');
    const finalConfig = (service.dockerConfig || '').replace(
      /\$\{APP_NAME\}/g,
      service.appName,
    );
    await fs.writeFile(composeFile, finalConfig, 'utf8');

    const resolved = await this.getExecContainerId(
      serviceId,
      config.composeService,
    );
    if ('error' in resolved) {
      return { success: false, output: resolved.error };
    }
    const sshIds = await this.servicesService.getDockerSshTargetIds(serviceId);
    if (sshIds.remoteServerId == null) {
      return { success: false, output: COMPOSE_NEEDS_DEPLOY_HOST_MESSAGE };
    }
    const projectUserId: number | null = null;
    const cid = resolved.id;
    const docker: StructuredDbImportDocker = {
      copyHostArchiveIntoContainer: (hostPath, destSpec) => {
        const idx = destSpec.indexOf(':');
        const pathInContainer = idx >= 0 ? destSpec.slice(idx + 1) : destSpec;
        return this.remoteServersService.uploadHostFileAndDockerCpToContainer(
          sshIds.remoteServerId!,
          projectUserId,
          hostPath,
          cid,
          pathInContainer,
        );
      },
      execInContainer: async (innerSh) => {
        const r = await this.remoteServersService.execDockerCliOnRemoteViaSsh(
          sshIds.remoteServerId!,
          projectUserId,
          `docker exec ${JSON.stringify(cid)} sh -c ${JSON.stringify(innerSh)}`,
        );
        return { stdout: r.stdout, stderr: r.stderr };
      },
      removeInContainer: async (containerPath) => {
        await this.remoteServersService.execDockerCliOnRemoteViaSsh(
          sshIds.remoteServerId!,
          projectUserId,
          `docker exec ${JSON.stringify(cid)} rm -f ${JSON.stringify(containerPath)}`,
        );
      },
    };
    return runStructuredDatabaseImport(config, hostArchivePath, docker, cid);
  }

  /** Restore a named volume from a .tar.gz produced by volume backup. */
  async importDockerVolume(
    volumeName: string,
    hostArchivePath: string,
    remoteServerId: number,
    projectUserId: number | null = null,
  ): Promise<{ success: boolean; output: string }> {
    try {
      const buf = await fs.readFile(hostArchivePath);
      const base = path.basename(hostArchivePath);
      const r = await this.remoteServersService.dockerNamedVolumeImportArchiveOnRemote(
        remoteServerId,
        projectUserId,
        volumeName,
        buf,
        base,
      );
      const out = [r.stdout, r.stderr].filter((s) => s?.trim()).join('\n');
      return { success: true, output: (out || 'Volume import finished.').slice(0, 8000) };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { success: false, output: msg };
    }
  }

  /**
   * Run a docker command that prints a SQL/text dump on stdout; gzip and write under `destDir`.
   * Use plain `pg_dump` text output (not `-Fc`). Command rules match `runWebhookDockerCommand`.
   */
  async backupDatabaseFromDockerCommand(
    serviceId: number,
    rawInput: string,
    destDir: string,
  ): Promise<{ success: boolean; output: string; archiveBasename?: string }> {
    const service = await this.servicesService.findOne(serviceId);
    const deployDir = getServiceDeploymentDir(
      service.appName,
      undefined,
    );
    await fs.mkdir(deployDir, { recursive: true });
    let cmd = rawInput.trim().replace(/\s+/g, ' ');
    const lower = cmd.toLowerCase();
    if (!lower.startsWith('docker')) {
      cmd = `docker ${cmd}`;
    } else if (!lower.startsWith('docker ')) {
      cmd = `docker ${cmd.slice(6).trim()}`;
    }
    if (!/^docker\s+/i.test(cmd)) {
      return {
        success: false,
        output:
          'Command must be a docker CLI invocation (e.g. docker compose exec -T db pg_dump …).',
      };
    }
    if (/[;&|`$\n\r]/.test(cmd)) {
      return {
        success: false,
        output:
          'Forbidden characters: use one docker command without ; | & ` $ or newlines.',
      };
    }
    const sshIds = await this.servicesService.getDockerSshTargetIds(serviceId);
    if (sshIds.remoteServerId == null) {
      return { success: false, output: COMPOSE_NEEDS_DEPLOY_HOST_MESSAGE };
    }
    const projectUserId: number | null = null;
    const persist = `${WEEHAWK_REMOTE_DEPLOYMENTS_BASE}/${toSafePathSegment(service.appName || 'service')}`;
    const persistQ = persist.replace(/'/g, `'\\''`);
    const body = `set -euo pipefail
cd '${persistQ}'
${cmd}
`;
    try {
      const r = await this.remoteServersService.execDockerCliOnRemoteViaSsh(
        sshIds.remoteServerId,
        projectUserId,
        body,
      );
      const stdout = r.stdout ?? '';
      const stderr = r.stderr ?? '';
      const err = stderr ?? '';
      const failed = stderrIndicatesDockerFailure(err);
      if (failed) {
        const out = [stdout, stderr].filter((s) => s && String(s).trim()).join('\n');
        return { success: false, output: out || '(no output)' };
      }
      const rawOut = stdout ?? '';
      if (!rawOut.length) {
        return {
          success: false,
          output: 'Database backup produced no output on stdout.',
        };
      }
      await fs.mkdir(destDir, { recursive: true });
      const archiveBasename = `db-${service.appName}-${Date.now()}.sql.gz`;
      const fullPath = path.join(path.resolve(destDir), archiveBasename);
      const gz = gzipSync(Buffer.from(rawOut, 'utf8'));
      await fs.writeFile(fullPath, gz);
      const out = [stdout, stderr]
        .filter((s) => s && String(s).trim())
        .join('\n');
      return {
        success: true,
        output: [out, `Archive: ${fullPath}`].filter(Boolean).join('\n'),
        archiveBasename,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { success: false, output: msg };
    }
  }

  /**
   * Run a single docker CLI line for a service deployment directory (cwd).
   * Input is forced to start with `docker` (prefix added if missing).
   */
  async runWebhookDockerCommand(
    serviceId: number,
    rawInput: string,
  ): Promise<{ success: boolean; output: string }> {
    const service = await this.servicesService.findOne(serviceId);
    const deployDir = getServiceDeploymentDir(
      service.appName,
      undefined,
    );
    await fs.mkdir(deployDir, { recursive: true });
    const script = rawInput.trim();
    if (!script) {
      return { success: false, output: 'Script is empty.' };
    }
    const sshIds = await this.servicesService.getDockerSshTargetIds(serviceId);
    if (sshIds.remoteServerId == null) {
      return { success: false, output: COMPOSE_NEEDS_DEPLOY_HOST_MESSAGE };
    }
    const projectUserId: number | null = null;
    const persist = `${WEEHAWK_REMOTE_DEPLOYMENTS_BASE}/${toSafePathSegment(service.appName || 'service')}`;
    const persistQ = persist.replace(/'/g, `'\\''`);
    const body = `set -euo pipefail
cd '${persistQ}'
${script}
`;
    try {
      const r = await this.remoteServersService.execDockerCliOnRemoteViaSsh(
        sshIds.remoteServerId,
        projectUserId,
        body,
      );
      const out = [r.stdout, r.stderr]
        .filter((s) => s && String(s).trim())
        .join('\n');
      return { success: true, output: out || '(no output)' };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { success: false, output: msg };
    }
  }

  async runSystemScript(
    rawInput: string,
    remoteServerId?: number | null,
    projectUserId?: number | null,
  ): Promise<{ success: boolean; output: string }> {
    const script = rawInput.trim();
    if (!script) {
      return { success: false, output: 'Script is empty.' };
    }
    if (remoteServerId == null) {
      return {
        success: false,
        output:
          'A remote server id is required. Scripts run on the deploy/build host over SSH, not on the Weehawk API machine.',
      };
    }
    try {
      const r = await this.remoteServersService.execDockerCliOnRemoteViaSsh(
        remoteServerId,
        projectUserId ?? null,
        script,
      );
      const out = [r.stdout, r.stderr]
        .filter((s) => s && String(s).trim())
        .join('\n');
      return { success: true, output: out || '(no output)' };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { success: false, output: msg };
    }
  }

  async shutdown(id: number) {
    const service = await this.servicesService.findOne(id);
    const sshIds = await this.servicesService.getDockerSshTargetIds(service.id);
    const projectUserId: number | null = null;
    const deployDir = getServiceDeploymentDir(
      service.appName,
      undefined,
    );

    try {
      if (isSwarmStackService(service)) {
        if (sshIds.remoteServerId == null) {
          throw new BadRequestException(SWARM_NEEDS_DEPLOY_HOST_MESSAGE);
        }
        await this.remoteServersService.scaleAllStackServicesToZeroViaSsh(
          sshIds.remoteServerId,
          projectUserId,
          service.appName,
        );
        return { success: true, message: 'Stack services scaled to 0 (Stopped)' };
      }
      if (sshIds.remoteServerId == null) {
        throw new BadRequestException(COMPOSE_NEEDS_DEPLOY_HOST_MESSAGE);
      }
      const deployEnv = parseEnv(service.env || '');
      await this.remoteServersService.composeInPersistentDeploymentViaSsh(
        sshIds.remoteServerId,
        projectUserId,
        {
          projectName: service.appName,
          composeArgvTail: ['stop'],
          deployEnv,
        },
      );
      return { success: true, message: 'Containers stopped' };
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new InternalServerErrorException(
        `Shutdown failed: ${error.message}`,
      );
    }
  }
}
