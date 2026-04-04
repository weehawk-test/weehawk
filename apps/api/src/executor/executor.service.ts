import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  forwardRef,
  Inject,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { exec } from 'child_process';
import { promisify } from 'util';
import { gzipSync } from 'zlib';
import * as fs from 'fs/promises';
import * as path from 'path';
import { ServicesService } from '../services/services.service';
import { composeType } from '../services/entities/composeType.enum';
import { Service } from '../services/entities/service.entity';
import type { ServiceVolumesResponseDto } from '../services/dto/service-volume-mount.dto';
import { getServiceDeploymentDir } from '../services/deployment-paths';
import { resolveEffectiveDockerfileRel } from '../services/weehawk-build-paths';
import { maybeRemoveApplicationSourceAfterDeploy } from './executor-app-source';
import { runIsolatedApplicationBuild } from './executor-application-build';
import { getApplicationBuildRuntimeImages } from './executor-build-config';
import {
  firstComposeServiceName,
  parseConfigHeaderValue,
  parseEnv,
} from './executor-compose-parse';
import { removeDeploymentFolder } from './executor-deployment-fs';
import { stderrIndicatesDockerFailure } from './executor-docker';
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
import { RemoteServersService } from '../remote-servers/remote-servers.service';

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

@Injectable()
export class ExecutorService {
  constructor(
    @Inject(forwardRef(() => ServicesService))
    private readonly servicesService: ServicesService,
    private readonly configService: ConfigService,
    private readonly remoteServersService: RemoteServersService,
  ) {}

  private async getProcessEnvForService(
    service: Service,
  ): Promise<NodeJS.ProcessEnv> {
    const envVars = parseEnv(service.env || '');
    const base: NodeJS.ProcessEnv = { ...process.env, ...envVars };
    return this.remoteServersService.mergeDockerHostEnv(service, base);
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

    const execOpts = {
      cwd: deployDir,
      env: await this.getProcessEnvForService(service),
    };
    const deployLogEmitter = options?.deployLogEmitter;
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
          const imageName = `${service.appName}:latest`;
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
            const rid =
              service.remoteServerId ?? service.remoteServer?.id ?? null;
            if (rid != null) {
              const fArg =
                dockerfileRel === 'Dockerfile'
                  ? ''
                  : ` -f "${dockerfileRel.replace(/"/g, '\\"')}"`;
              const buildCmd = `docker build${fArg} -t ${imageName} .`;
              const { stdout: bOut, stderr: bErr } = await execAsync(buildCmd, {
                cwd: fullContext,
                env: execOpts.env,
                maxBuffer: 50 * 1024 * 1024,
              });
              buildLogPrefix = [bOut, bErr]
                .filter((s) => s && String(s).trim())
                .join('\n');
              if (buildLogPrefix) {
                buildLogPrefix += '\n';
              }
            } else {
              const buildResult = await runIsolatedApplicationBuild(buildImages, {
                serviceId: service.id,
                fullContextHostPath: fullContext,
                dockerfilePathFromConfig: dockerfilePath,
                imageName,
                execEnv: execOpts.env,
                deployLogEmitter,
              });
              buildLogPrefix = [buildResult.stdout, buildResult.stderr]
                .filter((s) => s && String(s).trim())
                .join('\n');
              if (buildLogPrefix) {
                buildLogPrefix += '\n';
              }
            }
          }
          /* If source was removed after a previous deploy, skip build and rely on existing local image + stack deploy. */
        }
        const command = `docker stack deploy -c "${composeFile}" ${service.appName}`;
        const { stdout, stderr } = await execAsync(command, execOpts);
        let out = [buildLogPrefix, stdout, stderr].filter((s) => s && s.trim()).join('\n');
        let err = stderr ?? '';

        if (mode === 'redeploy') {
          const forced = await forceRollingRestartStackServices(
            service.appName,
            pickDockerSshEnv(execOpts.env),
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
      }

      const base = `docker compose -f "${composeFile}" -p ${service.appName}`;
      let command: string;
      if (mode === 'redeploy') {
        try {
          await execAsync(`${base} stop`, execOpts);
        } catch {
          /* already stopped or nothing to stop */
        }
        command = `${base} up -d --build`;
      } else if (mode === 'deploy') {
        command = `${base} up -d --build`;
      } else {
        command = `${base} up -d --no-build`;
      }

      const { stdout, stderr } = await execAsync(command, execOpts);
      const out = [stdout, stderr].filter((s) => s && s.trim()).join('\n');
      const err = stderr ?? '';
      const stderrIndicatesFailure = stderrIndicatesDockerFailure(err);
      return { success: !stderrIndicatesFailure, output: out };
    } catch (error) {
      if (mode === 'deploy') {
        await removeDeploymentFolder(deployDir);
      }
      throw new InternalServerErrorException(
        `Deployment failed: ${error.message}`,
      );
    }
  }

  /** Start stopped containers; compose tries `start` then `up -d --no-build`. Stack: stack deploy. */
  async startContainers(id: number) {
    const service = await this.servicesService.findOne(id);
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

    if (isSwarmStackService(service)) {
      return await this.execute(id, 'reload');
    }

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
    const deployDir = getServiceDeploymentDir(
      service.appName,
      this.configService.get<string>('WEEHAWK_DEPLOYMENTS_DIR'),
    );
    const composeFile = path.join(deployDir, 'docker-compose.yml');

    try {
      if (isSwarmStackService(service)) {
        const { stdout } = await execAsync(
          `docker stack services ${service.appName} --format "{{.Replicas}}"`,
          { env: procEnv },
        );
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
        const { stdout } = await execAsync(
          `docker ps -q -f "name=${service.appName}_${key}" -f "status=running"`,
          { env: procEnv },
        );
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
    const deployDir = getServiceDeploymentDir(
      service.appName,
      this.configService.get<string>('WEEHAWK_DEPLOYMENTS_DIR'),
    );
    const composeFile = path.join(deployDir, 'docker-compose.yml');

    try {
      if (isSwarmStackService(service)) {
        await execAsync(`docker stack rm ${service.appName}`, { env: procEnv });
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
          'Command must be a docker CLI invocation (e.g. docker ps, docker compose …).',
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
        maxBuffer: 10 * 1024 * 1024,
        timeout: 180_000,
      });
      const out = [stdout, stderr]
        .filter((s) => s && String(s).trim())
        .join('\n');
      const err = stderr ?? '';
      const failed = stderrIndicatesDockerFailure(err);
      return { success: !failed, output: out || '(no output)' };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { success: false, output: msg };
    }
  }

  async shutdown(id: number) {
    const service = await this.servicesService.findOne(id);
    const procEnv = await this.getProcessEnvForService(service);
    const deployDir = getServiceDeploymentDir(
      service.appName,
      this.configService.get<string>('WEEHAWK_DEPLOYMENTS_DIR'),
    );

    try {
      if (isSwarmStackService(service)) {
        await scaleAllStackServicesToZero(
          service.appName,
          pickDockerSshEnv(procEnv),
        );
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
