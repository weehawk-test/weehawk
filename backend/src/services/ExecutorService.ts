import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  forwardRef,
  Inject,
} from '@nestjs/common';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';
import { ServicesService } from './services.service';
import { composeType } from './entities/composeType.enum';
import { Service } from './entities/service.entity';
import type {
  ServiceVolumeMountDto,
  ServiceVolumesResponseDto,
} from './dto/service-volume-mount.dto';

const execAsync = promisify(exec);

@Injectable()
export class ExecutorService {
  constructor(
    @Inject(forwardRef(() => ServicesService))
    private readonly servicesService: ServicesService,
  ) {}

  /**
   * Rolling restart every Swarm service in a stack (same compose file, tasks recreated).
   */
  private async forceRollingRestartStackServices(stackName: string): Promise<{
    output: string;
    stderr: string;
  }> {
    const { stdout } = await execAsync(
      `docker stack services ${stackName} --format "{{.Name}}"`,
    );
    const names = stdout
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    const chunks: string[] = [];
    let combinedStderr = '';
    for (const name of names) {
      const { stdout: uo, stderr: ue } = await execAsync(
        `docker service update --force ${name}`,
        { maxBuffer: 10 * 1024 * 1024 },
      );
      chunks.push([uo, ue].filter((s) => s && String(s).trim()).join('\n'));
      combinedStderr += ue ?? '';
    }
    return { output: chunks.join('\n'), stderr: combinedStderr };
  }

  private stderrIndicatesDockerFailure(stderr: string): boolean {
    return (
      /level=(warning|error|fatal)/i.test(stderr) ||
      /Error response from daemon/i.test(stderr) ||
      /Cannot connect to the Docker daemon/i.test(stderr)
    );
  }

  /**
   * @param mode `deploy` = build then up (compose) or stack deploy; `reload` = compose up --no-build or stack deploy;
   * `redeploy` = stop compose project then up --build, or stack deploy + forced rolling restart on every service.
   */
  async execute(id: number, mode: 'deploy' | 'reload' | 'redeploy' = 'deploy') {
    const service = await this.servicesService.findOne(id);
    const deployDir = path.join(process.cwd(), 'deployments', service.appName);

    await fs.mkdir(deployDir, { recursive: true });
    const composeFile = path.join(deployDir, 'docker-compose.yml');

    const finalConfig = service.dockerConfig.replace(/\${APP_NAME}/g, service.appName);
    await fs.writeFile(composeFile, finalConfig);

    const envVars = this.parseEnv(service.env || '');
    const execOpts = {
      cwd: deployDir,
      env: { ...process.env, ...envVars },
    };

    try {
      if (service.composeType === composeType.STACK) {
        const command = `docker stack deploy -c "${composeFile}" ${service.appName}`;
        const { stdout, stderr } = await execAsync(command, execOpts);
        let out = [stdout, stderr].filter((s) => s && s.trim()).join('\n');
        let err = stderr ?? '';

        if (mode === 'redeploy') {
          const forced = await this.forceRollingRestartStackServices(service.appName);
          out = [out, forced.output].filter(Boolean).join('\n');
          err += forced.stderr;
        }

        const stderrIndicatesFailure = this.stderrIndicatesDockerFailure(err);
        return { success: !stderrIndicatesFailure, output: out };
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
      const stderrIndicatesFailure = this.stderrIndicatesDockerFailure(err);
      return { success: !stderrIndicatesFailure, output: out };
    } catch (error) {
      if (mode === 'deploy') {
        await this.removeDeploymentFolder(deployDir);
      }
      throw new InternalServerErrorException(`Deployment failed: ${error.message}`);
    }
  }

  /** Start stopped containers; compose tries `start` then `up -d --no-build`. Stack: stack deploy. */
  async startContainers(id: number) {
    const service = await this.servicesService.findOne(id);
    const deployDir = path.join(process.cwd(), 'deployments', service.appName);
    const composeFile = path.join(deployDir, 'docker-compose.yml');

    await fs.mkdir(deployDir, { recursive: true });
    const finalConfig = service.dockerConfig.replace(/\${APP_NAME}/g, service.appName);
    await fs.writeFile(composeFile, finalConfig);
    const envVars = this.parseEnv(service.env || '');

    if (service.composeType === composeType.STACK) {
      return await this.execute(id, 'reload');
    }

    const base = `docker compose -f "${composeFile}" -p ${service.appName}`;
    try {
      const { stdout, stderr } = await execAsync(`${base} start`, {
        cwd: deployDir,
        env: { ...process.env, ...envVars },
      });
      const outStart = [stdout, stderr].filter((s) => s && s.trim()).join('\n');
      return { success: true, output: outStart };
    } catch {
      try {
        const { stdout, stderr } = await execAsync(`${base} up -d --no-build`, {
          cwd: deployDir,
          env: { ...process.env, ...envVars },
        });
        const outUp = [stdout, stderr].filter((s) => s && s.trim()).join('\n');
        return { success: true, output: outUp };
      } catch (error) {
        throw new InternalServerErrorException(`Start failed: ${error.message}`);
      }
    }
  }

  async getRuntimeStatus(id: number): Promise<{ running: boolean }> {
    const service = await this.servicesService.findOne(id);
    const deployDir = path.join(process.cwd(), 'deployments', service.appName);
    const composeFile = path.join(deployDir, 'docker-compose.yml');

    try {
      if (service.composeType === composeType.STACK) {
        const { stdout } = await execAsync(`docker stack services ${service.appName} --format "{{.Replicas}}"`);
        const running = stdout.split(/\r?\n/).some((line) => {
          const m = line.trim().match(/^(\d+)\//);
          return m !== null && parseInt(m[1], 10) > 0;
        });
        return { running };
      }

      const exists = await fs.access(composeFile).then(() => true).catch(() => false);
      if (!exists) return { running: false };

      const { stdout } = await execAsync(
        `docker compose -f "${composeFile}" -p ${service.appName} ps --status running -q`,
        { cwd: deployDir },
      );
      return { running: stdout.trim().length > 0 };
    } catch {
      return { running: false };
    }
  }

  /** First `services:` key in compose YAML (which service to exec into). */
  private firstComposeServiceName(config: string): string {
    const lines = config.split(/\r?\n/);
    let inServices = false;
    for (const line of lines) {
      const t = line.trim();
      if (!inServices) {
        if (t === 'services:' || /^\s*services:\s*$/.test(line)) inServices = true;
        continue;
      }
      if (!t || t.startsWith('#')) continue;
      if (/^[a-zA-Z_]/.test(line) && !line.startsWith(' ')) break;
      const m = line.match(/^\s{2}([a-zA-Z0-9_.-]+)\s*:/);
      if (m) return m[1];
    }
    return 'app';
  }

  /**
   * Resolves a running container ID for docker exec (compose project or Swarm stack task).
   */
  async getExecContainerId(
    id: number,
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

    const deployDir = path.join(process.cwd(), 'deployments', service.appName);
    const composeFile = path.join(deployDir, 'docker-compose.yml');
    const key = this.firstComposeServiceName(service.dockerConfig || '');

    try {
      if (service.composeType === composeType.STACK) {
        const { stdout } = await execAsync(
          `docker ps -q -f "name=${service.appName}_${key}" -f "status=running"`,
        );
        const cid = stdout
          .trim()
          .split(/\r?\n/)
          .filter(Boolean)[0];
        if (!cid) {
          return {
            error:
              'No running container for this stack service. Start the service on the host first.',
          };
        }
        return { id: cid };
      }

      const exists = await fs.access(composeFile).then(() => true).catch(() => false);
      if (!exists) {
        return {
          error: 'Compose file not found on the server. Deploy this service first.',
        };
      }

      const { stdout } = await execAsync(
        `docker compose -f "${composeFile}" -p ${service.appName} ps -q --status running ${key}`,
        { cwd: deployDir },
      );
      const cid = stdout
        .trim()
        .split(/\r?\n/)
        .filter(Boolean)[0];
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
    const deployDir = path.join(process.cwd(), 'deployments', service.appName);
    const composeFile = path.join(deployDir, 'docker-compose.yml');

    try {
      if (service.composeType === composeType.STACK) {
        await execAsync(`docker stack rm ${service.appName}`);
        console.log(`Stack ${service.appName} removed from Swarm.`);
      } else {
        const fileExists = await fs.access(composeFile).then(() => true).catch(() => false);
        if (fileExists) {
          await execAsync(`docker compose -f ${composeFile} -p ${service.appName} down -v`, { 
            cwd: deployDir,
            timeout: 30000
          });
          console.log(`Compose project ${service.appName} stopped and volumes removed.`);
        }
      }
    } catch (error) {
      console.error(`Clean stop failed, attempting force removal: ${error.message}`);
      await execAsync(`docker rm -f ${service.appName}`).catch(() => {});
    } finally {
      await this.removeDeploymentFolder(deployDir);
    }
  }

  private async removeDeploymentFolder(dir: string) {
    try {
      await fs.rm(dir, { recursive: true, force: true });
    } catch (e) {
      console.error(`Could not remove directory: ${dir}`);
    }
  }

  private parseShortVolumeMountString(
    s: string,
  ): Omit<ServiceVolumeMountDto, 'composeService'> | null {
    const t = s.trim();
    if (!t) return null;
    const parts = t.split(':');
    if (parts.length < 2) return null;
    const source = parts[0];
    const target = parts[1];
    const mode = (parts[2] ?? '').toLowerCase();
    const readOnly = mode.includes('ro');
    const isBind =
      source.startsWith('.') ||
      source.startsWith('/') ||
      source.startsWith('~') ||
      /^[a-zA-Z]:[\\/]/.test(source);
    return {
      mountType: isBind ? 'bind' : 'volume',
      source,
      target,
      readOnly,
    };
  }

  private flattenVolumesFromComposeJson(
    cfg: Record<string, unknown>,
  ): ServiceVolumeMountDto[] {
    const services = cfg['services'] as
      | Record<string, { volumes?: unknown[] }>
      | undefined;
    const volDefs = cfg['volumes'] as
      | Record<string, { name?: string }>
      | undefined;
    if (!services || typeof services !== 'object') return [];

    const out: ServiceVolumeMountDto[] = [];
    for (const [svcName, svc] of Object.entries(services)) {
      if (!svc || typeof svc !== 'object') continue;
      const vols = (svc as { volumes?: unknown[] }).volumes;
      if (!Array.isArray(vols)) continue;

      for (const v of vols) {
        if (typeof v === 'string') {
          const parsed = this.parseShortVolumeMountString(v);
          if (parsed) {
            out.push({ composeService: svcName, ...parsed });
          }
          continue;
        }
        if (!v || typeof v !== 'object') continue;
        const o = v as Record<string, unknown>;
        const typeRaw = String(o.type ?? 'unknown').toLowerCase();
        const mountType =
          typeRaw === 'bind'
            ? 'bind'
            : typeRaw === 'volume'
              ? 'volume'
              : typeRaw === 'tmpfs'
                ? 'tmpfs'
                : 'unknown';

        const source = String(o.source ?? '').trim() || '—';
        const target = String(o.target ?? '').trim() || '—';
        const readOnly = o.read_only === true;

        let hostVolumeName: string | undefined;
        if (mountType === 'volume' && volDefs && source !== '—') {
          const def = volDefs[source];
          if (def?.name) hostVolumeName = String(def.name);
        }

        out.push({
          composeService: svcName,
          mountType,
          source,
          target,
          readOnly,
          hostVolumeName,
        });
      }
    }

    return out;
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

    const deployDir = path.join(process.cwd(), 'deployments', service.appName);
    const composeFile = path.join(deployDir, 'docker-compose.yml');
    await fs.mkdir(deployDir, { recursive: true });
    const finalConfig = service.dockerConfig.replace(
      /\${APP_NAME}/g,
      service.appName,
    );
    await fs.writeFile(composeFile, finalConfig, 'utf8');
    const envVars = this.parseEnv(service.env || '');

    try {
      const { stdout } = await execAsync(
        `docker compose -f "${composeFile}" -p ${service.appName} config --format json`,
        {
          cwd: deployDir,
          env: { ...process.env, ...envVars },
          maxBuffer: 20 * 1024 * 1024,
        },
      );
      const cfg = JSON.parse(stdout) as Record<string, unknown>;
      const items = this.flattenVolumesFromComposeJson(cfg);
      return { items };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return {
        items: [],
        error: `Could not parse compose volumes (is Docker available and the YAML valid?): ${msg}`,
      };
    }
  }

  private parseEnv(envString: string): Record<string, string> {
    const envVars: Record<string, string> = {};
    if (!envString) return envVars;

    envString.split('\n').forEach(line => {
      const trimmedLine = line.trim();
      if (trimmedLine && !trimmedLine.startsWith('#')) {
        const [key, ...valueParts] = trimmedLine.split('=');
        if (key && valueParts.length > 0) {
          envVars[key.trim()] = valueParts.join('=').trim();
        }
      }
    });
    return envVars;
  }

  /**
   * Backup a named Docker volume to `destDir` as a .tar.gz (host path must be absolute).
   */
  async backupDockerVolume(
    volumeName: string,
    destDir: string,
  ): Promise<{ success: boolean; output: string; archiveBasename?: string }> {
    const safe = volumeName.trim();
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(safe)) {
      return { success: false, output: 'Invalid volume name.' };
    }
    await fs.mkdir(destDir, { recursive: true });
    const outDir = path.resolve(destDir);
    const archiveBasename = `vol-${safe}-${Date.now()}.tar.gz`;
    const hostOut = path.join(outDir, archiveBasename);
    const hostMount = outDir.replace(/\\/g, '/').replace(/"/g, '\\"');
    try {
      const { stdout, stderr } = await execAsync(
        `docker run --rm -v "${safe}:/v:ro" -v "${hostMount}:/out" alpine tar czf "/out/${archiveBasename}" -C /v .`,
        { maxBuffer: 20 * 1024 * 1024, timeout: 600_000 },
      );
      const out = [stdout, stderr].filter((s) => s && String(s).trim()).join('\n');
      const err = stderr ?? '';
      const failed = this.stderrIndicatesDockerFailure(err);
      return {
        success: !failed,
        output: [out, `Archive: ${hostOut}`].filter(Boolean).join('\n'),
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
    const deployDir = path.join(process.cwd(), 'deployments', service.appName);
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
        output: 'Command must be a docker CLI invocation (e.g. docker ps, docker compose …).',
      };
    }
    if (/[;&|`$\n\r]/.test(cmd)) {
      return {
        success: false,
        output:
          'Forbidden characters: use one docker command without ; | & ` $ or newlines.',
      };
    }
    const envVars = this.parseEnv(service.env || '');
    try {
      const { stdout, stderr } = await execAsync(cmd, {
        cwd: deployDir,
        env: { ...process.env, ...envVars },
        maxBuffer: 10 * 1024 * 1024,
        timeout: 180_000,
      });
      const out = [stdout, stderr].filter((s) => s && String(s).trim()).join('\n');
      const err = stderr ?? '';
      const failed = this.stderrIndicatesDockerFailure(err);
      return { success: !failed, output: out || '(no output)' };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { success: false, output: msg };
    }
  }

  async shutdown(id: number) {
    const service = await this.servicesService.findOne(id);
    const deployDir = path.join(process.cwd(), 'deployments', service.appName);

    try {
      if (service.composeType === composeType.STACK) {
        await execAsync(`docker service scale ${service.appName}=0`);
        return { success: true, message: 'Service scaled to 0 (Stopped)' };
      } else {
        const composeFile = path.join(deployDir, 'docker-compose.yml');
        await execAsync(`docker compose -f "${composeFile}" -p ${service.appName} stop`);
        return { success: true, message: 'Containers stopped' };
      }
    } catch (error) {
      throw new InternalServerErrorException(`Shutdown failed: ${error.message}`);
    }
  }
}