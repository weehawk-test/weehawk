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
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
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
import { runIsolatedApplicationBuild } from './executor-application-build';
import { getApplicationBuildRuntimeImages } from './executor-build-config';
import {
  firstComposeServiceName,
  firstImageRefFromComposeYaml,
  parseConfigHeaderValue,
  parseEnv,
} from './executor-compose-parse';
import { removeDeploymentFolder } from './executor-deployment-fs';
import {
  emitDeployLog,
  formatExecError,
  spawnDockerSubcommand,
  stderrIndicatesDockerFailure,
} from './executor-docker';
import type { ExecuteDeployOptions } from './executor-types';
import {
  forceRollingRestartStackServices,
  isSwarmStackService,
  scaleAllStackServicesToZero,
} from './executor-swarm';
import { flattenVolumesFromComposeJson } from './executor-volumes';
import { runStructuredDatabaseBackup } from './executor-structured-db-backup';
import { runStructuredDatabaseImport } from './executor-structured-db-import';
import { runDockerVolumeBackup } from './executor-volume-backup';
import { runDockerVolumeImport } from './executor-volume-import';
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

const execAsync = promisify(exec);

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

/** Isolated `docker run` builds must talk to the API host’s default daemon, not DOCKER_HOST from process.env / service.env. */
function envForLocalDockerCli(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const o = { ...base };
  delete o.DOCKER_HOST;
  delete o.DOCKER_SSH_OPTS;
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
      this.configService.get<string>('WEEHAWK_DEPLOYMENTS_DIR'),
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
    const buildImages = getApplicationBuildRuntimeImages(this.configService);

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
              const buildResult = await runIsolatedApplicationBuild(buildImages, {
                serviceId: service.id,
                fullContextHostPath: fullContext,
                dockerfilePathFromConfig: dockerfilePath,
                imageName: imageTag,
                execEnv: envForLocalDockerCli(buildBase),
                deployLogEmitter,
              });
              buildLogPrefix = [buildResult.stdout, buildResult.stderr]
                .filter((s) => s && String(s).trim())
                .join('\n');
              if (buildLogPrefix) {
                buildLogPrefix += '\n';
              }
            }
            if (registryPush?.trim()) {
              if (useRemoteDockerBuild && buildRemoteServerId != null) {
                emitChunk(`Pushing image "${registryPush}" on remote host…\n`);
                const pushAuth =
                  await this.registryService.getRegistryAuthConfigForImageRef(
                    registryPush,
                  );
                try {
                  const pushResult =
                    await this.remoteServersService.pushImageUsingDockerodeSsh(
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
              } else {
                emitChunk(`Pushing image "${registryPush}" locally…\n`);
                const pushEsc = registryPush.replace(/"/g, '\\"');
                const pushCmd = `docker push "${pushEsc}"`;
                const pushEnv = envForLocalDockerCli(buildBase);
                const merged = await this.registryService.mergePushEnvForImageRef(
                  registryPush,
                  pushEnv,
                );
                const mergedEnv = merged.env;
                try {
                  const { stdout: pu, stderr: pe } = await execAsync(pushCmd, {
                    cwd: fullContext,
                    env: mergedEnv,
                    maxBuffer: 50 * 1024 * 1024,
                  });
                  const pushLog = [pu, pe]
                    .filter((s) => s && String(s).trim())
                    .join('\n');
                  if (pushLog) {
                    buildLogPrefix = (buildLogPrefix || '') + pushLog + '\n';
                  }
                } catch (pushErr) {
                  if (mode === 'deploy') {
                    await removeDeploymentFolder(deployDir);
                  }
                  return {
                    success: false,
                    output:
                      `Docker registry push failed for "${registryPush}". Check saved registry credentials for this host and project permissions.\n\n` +
                      formatExecError(pushErr),
                  };
                } finally {
                  await merged.cleanup();
                }
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

        try {
          const { stdout, stderr } = await spawnDockerSubcommand(
            [
              'stack',
              'deploy',
              '-c',
              composeFile,
              '--with-registry-auth',
              service.appName,
            ],
            {
              cwd: execOpts.cwd,
              env: stackDeployEnv,
              deployLogEmitter,
            },
          );
          let out = [buildLogPrefix, stdout, stderr].filter((s) => s && s.trim()).join('\n');
          let err = [buildLogPrefix, stderr]
            .filter((s) => s && String(s).trim())
            .join('\n');

          if (mode === 'redeploy') {
            const forced = await forceRollingRestartStackServices(
              service.appName,
              pickDockerSshEnv(execOpts.env),
              deployLogEmitter,
            );
            out = [out, forced.output].filter(Boolean).join('\n');
            err += forced.stderr;
          }

          const stderrIndicatesFailure = stderrIndicatesDockerFailure(err);
          const success = !stderrIndicatesFailure;
          if (success) {
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

      if (mode === 'redeploy') {
        try {
          await spawnDockerSubcommand(
            ['compose', '-f', composeFile, '-p', service.appName, 'stop'],
            { ...execOpts, deployLogEmitter },
          );
        } catch {
          /* already stopped or nothing to stop */
        }
      }
      const composeUpArgs =
        mode === 'deploy' || mode === 'redeploy'
          ? (['compose', '-f', composeFile, '-p', service.appName, 'up', '-d', '--build'] as const)
          : (['compose', '-f', composeFile, '-p', service.appName, 'up', '-d', '--no-build'] as const);

      const { stdout, stderr } = await spawnDockerSubcommand([...composeUpArgs], {
        ...execOpts,
        deployLogEmitter,
      });
      const out = [stdout, stderr].filter((s) => s && s.trim()).join('\n');
      const err = stderr ?? '';
      const stderrIndicatesFailure = stderrIndicatesDockerFailure(err);
      return { success: !stderrIndicatesFailure, output: out };
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
      this.configService.get<string>('WEEHAWK_DEPLOYMENTS_DIR'),
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
      this.configService.get<string>('WEEHAWK_DEPLOYMENTS_DIR'),
    );
    const composeFile = path.join(deployDir, 'docker-compose.yml');

    await fs.mkdir(deployDir, { recursive: true });
    const finalConfig = service.dockerConfig.replace(
      /\${APP_NAME}/g,
      service.appName,
    );
    await fs.writeFile(composeFile, finalConfig);
    const procEnv = await this.getProcessEnvForService(service);

    const base = `docker compose -f "${composeFile}" -p ${service.appName}`;
    try {
      const { stdout, stderr } = await execAsync(`${base} start`, {
        cwd: deployDir,
        env: procEnv,
      });
      const outStart = [stdout, stderr].filter((s) => s && s.trim()).join('\n');
      return { success: true, output: outStart };
    } catch {
      try {
        const { stdout, stderr } = await execAsync(`${base} up -d --no-build`, {
          cwd: deployDir,
          env: procEnv,
        });
        const outUp = [stdout, stderr].filter((s) => s && s.trim()).join('\n');
        return { success: true, output: outUp };
      } catch (error) {
        throw new InternalServerErrorException(
          `Start failed: ${error.message}`,
        );
      }
    }
  }

  async getRuntimeStatus(id: number): Promise<{ running: boolean }> {
    const service = await this.servicesService.findOne(id);
    const procEnv = await this.getProcessEnvForService(service);
    const sshIds = await this.servicesService.getDockerSshTargetIds(service.id);
    const projectUserId: number | null = null;
    const deployDir = getServiceDeploymentDir(
      service.appName,
      this.configService.get<string>('WEEHAWK_DEPLOYMENTS_DIR'),
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
          const r = await execAsync(
            `docker stack services ${service.appName} --format "{{.Replicas}}"`,
            { env: procEnv },
          );
          stdout = r.stdout;
        }
        const running = stdout.split(/\r?\n/).some((line) => {
          const m = line.trim().match(/^(\d+)\//);
          return m !== null && parseInt(m[1], 10) > 0;
        });
        return { running };
      }

      const exists = await fs
        .access(composeFile)
        .then(() => true)
        .catch(() => false);
      if (!exists) return { running: false };

      const { stdout } = await execAsync(
        `docker compose -f "${composeFile}" -p ${service.appName} ps --status running -q`,
        { cwd: deployDir, env: procEnv },
      );
      return { running: stdout.trim().length > 0 };
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
      this.configService.get<string>('WEEHAWK_DEPLOYMENTS_DIR'),
    );
    const composeFile = path.join(deployDir, 'docker-compose.yml');
    const procEnv = await this.getProcessEnvForService(service);
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
          const r = await execAsync(
            `docker ps -q -f "name=${service.appName}_${key}" -f "status=running"`,
            { env: procEnv },
          );
          stdout = r.stdout;
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

      const { stdout } = await execAsync(
        `docker compose -f "${composeFile}" -p ${service.appName} ps -q --status running ${key}`,
        { cwd: deployDir, env: procEnv },
      );
      const cid = stdout.trim().split(/\r?\n/).filter(Boolean)[0];
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
    const procEnv = await this.getProcessEnvForService(service);
    const sshIds = await this.servicesService.getDockerSshTargetIds(service.id);
    const projectUserId: number | null = null;
    const deployDir = getServiceDeploymentDir(
      service.appName,
      this.configService.get<string>('WEEHAWK_DEPLOYMENTS_DIR'),
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
        } else {
          await execAsync(`docker stack rm ${service.appName}`, { env: procEnv });
        }
        console.log(`Stack ${service.appName} removed from Swarm.`);
      } else {
        const fileExists = await fs
          .access(composeFile)
          .then(() => true)
          .catch(() => false);
        if (fileExists) {
          await execAsync(
            `docker compose -f ${composeFile} -p ${service.appName} down -v`,
            {
              cwd: deployDir,
              timeout: 30000,
              env: procEnv,
            },
          );
          console.log(
            `Compose project ${service.appName} stopped and volumes removed.`,
          );
        }
      }
    } catch (error) {
      console.error(
        `Clean stop failed, attempting force removal: ${error.message}`,
      );
      await execAsync(`docker rm -f ${service.appName}`, {
        env: procEnv,
      }).catch(() => {});
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
      this.configService.get<string>('WEEHAWK_DEPLOYMENTS_DIR'),
    );
    const composeFile = path.join(deployDir, 'docker-compose.yml');
    await fs.mkdir(deployDir, { recursive: true });
    const finalConfig = service.dockerConfig.replace(
      /\${APP_NAME}/g,
      service.appName,
    );
    await fs.writeFile(composeFile, finalConfig, 'utf8');
    const procEnv = await this.getProcessEnvForService(service);

    try {
      const { stdout } = await execAsync(
        `docker compose -f "${composeFile}" -p ${service.appName} config --format json`,
        {
          cwd: deployDir,
          env: procEnv,
          maxBuffer: 20 * 1024 * 1024,
        },
      );
      const cfg = JSON.parse(stdout) as Record<string, unknown>;
      const items = flattenVolumesFromComposeJson(cfg);
      return { items };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return {
        items: [],
        error: `Could not parse compose volumes (is Docker available and the YAML valid?): ${msg}`,
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
      this.configService.get<string>('WEEHAWK_DEPLOYMENTS_DIR'),
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

    const procEnv = await this.getProcessEnvForService(service);
    return runStructuredDatabaseBackup(
      deployDir,
      config,
      destDir,
      service.appName,
      procEnv,
      resolved.id,
    );
  }

  async backupDockerVolume(
    volumeName: string,
    destDir: string,
  ): Promise<{ success: boolean; output: string; archiveBasename?: string }> {
    return runDockerVolumeBackup(volumeName, destDir);
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
      this.configService.get<string>('WEEHAWK_DEPLOYMENTS_DIR'),
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
    const procEnv = await this.getProcessEnvForService(service);
    return runStructuredDatabaseImport(
      config,
      hostArchivePath,
      procEnv,
      resolved.id,
    );
  }

  /** Restore a named volume from a .tar.gz produced by volume backup. */
  async importDockerVolume(
    volumeName: string,
    hostArchivePath: string,
  ): Promise<{ success: boolean; output: string }> {
    return runDockerVolumeImport(volumeName, hostArchivePath);
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
      this.configService.get<string>('WEEHAWK_DEPLOYMENTS_DIR'),
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
    const procEnv = await this.getProcessEnvForService(service);
    try {
      const { stdout, stderr } = await execAsync(cmd, {
        cwd: deployDir,
        env: procEnv,
        maxBuffer: 512 * 1024 * 1024,
        timeout: 600_000,
      });
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
      this.configService.get<string>('WEEHAWK_DEPLOYMENTS_DIR'),
    );
    await fs.mkdir(deployDir, { recursive: true });
    const script = rawInput.trim();
    if (!script) {
      return { success: false, output: 'Script is empty.' };
    }
    const procEnv = await this.getProcessEnvForService(service);
    try {
      const out = await this.runBashScriptFromStdin(script, {
        cwd: deployDir,
        env: procEnv,
        timeoutMs: 180_000,
        maxOutputBytes: 10 * 1024 * 1024,
      });
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
    if (remoteServerId != null) {
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
    const workDir = this.configService.get<string>('WEEHAWK_DEPLOYMENTS_DIR') || process.cwd();
    try {
      const out = await this.runBashScriptFromStdin(script, {
        cwd: workDir,
        env: process.env,
        timeoutMs: 180_000,
        maxOutputBytes: 10 * 1024 * 1024,
      });
      return { success: true, output: out || '(no output)' };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { success: false, output: msg };
    }
  }

  private async runBashScriptFromStdin(
    script: string,
    opts: {
      cwd: string;
      env: NodeJS.ProcessEnv;
      timeoutMs: number;
      maxOutputBytes: number;
    },
  ): Promise<string> {
    return await new Promise((resolve, reject) => {
      const child = spawn('bash', ['-s'], {
        cwd: opts.cwd,
        env: opts.env,
      });
      let stdout = '';
      let stderr = '';
      let done = false;
      let totalBytes = 0;

      const finish = (err?: Error, output?: string) => {
        if (done) return;
        done = true;
        clearTimeout(timeout);
        if (err) reject(err);
        else resolve(output ?? '');
      };

      const appendChunk = (chunk: Buffer, target: 'stdout' | 'stderr') => {
        totalBytes += chunk.length;
        if (totalBytes > opts.maxOutputBytes) {
          child.kill('SIGKILL');
          finish(new Error('Script output exceeded limit.'));
          return;
        }
        const text = chunk.toString();
        if (target === 'stdout') stdout += text;
        else stderr += text;
      };

      const timeout = setTimeout(() => {
        child.kill('SIGKILL');
        finish(new Error('Script execution timed out.'));
      }, opts.timeoutMs);

      child.stdout.on('data', (d: Buffer) => appendChunk(d, 'stdout'));
      child.stderr.on('data', (d: Buffer) => appendChunk(d, 'stderr'));
      child.on('error', (e) => finish(e));
      child.on('close', (code) => {
        if (code !== 0) {
          finish(new Error((stderr || `Script exited with code ${code}`).trim()));
          return;
        }
        finish(undefined, [stdout, stderr].filter((s) => s && s.trim()).join('\n'));
      });

      child.stdin.write(script, 'utf8', (err) => {
        if (err) {
          finish(err);
          return;
        }
        child.stdin.end();
      });
    });
  }

  async shutdown(id: number) {
    const service = await this.servicesService.findOne(id);
    const procEnv = await this.getProcessEnvForService(service);
    const sshIds = await this.servicesService.getDockerSshTargetIds(service.id);
    const projectUserId: number | null = null;
    const deployDir = getServiceDeploymentDir(
      service.appName,
      this.configService.get<string>('WEEHAWK_DEPLOYMENTS_DIR'),
    );

    try {
      if (isSwarmStackService(service)) {
        if (sshIds.remoteServerId != null) {
          await this.remoteServersService.scaleAllStackServicesToZeroViaSsh(
            sshIds.remoteServerId,
            projectUserId,
            service.appName,
          );
        } else {
          await scaleAllStackServicesToZero(
            service.appName,
            pickDockerSshEnv(procEnv),
          );
        }
        return { success: true, message: 'Stack services scaled to 0 (Stopped)' };
      } else {
        const composeFile = path.join(deployDir, 'docker-compose.yml');
        await execAsync(
          `docker compose -f "${composeFile}" -p ${service.appName} stop`,
          { env: procEnv },
        );
        return { success: true, message: 'Containers stopped' };
      }
    } catch (error) {
      throw new InternalServerErrorException(
        `Shutdown failed: ${error.message}`,
      );
    }
  }
}
