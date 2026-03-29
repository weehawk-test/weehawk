import { Injectable, InternalServerErrorException, forwardRef, Inject } from '@nestjs/common';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';
import { ServicesService } from './services.service';
import { composeType } from './entities/composeType.enum';

const execAsync = promisify(exec);

@Injectable()
export class ExecutorService {
  constructor(
    @Inject(forwardRef(() => ServicesService))
    private readonly servicesService: ServicesService,
  ) {}

  /**
   * @param mode `deploy` = build images then up; `reload` = up without build (compose --no-build). Stack: both use stack deploy (no local build).
   */
  async execute(id: number, mode: 'deploy' | 'reload' = 'deploy') {
    const service = await this.servicesService.findOne(id);
    const deployDir = path.join(process.cwd(), 'deployments', service.appName);

    await fs.mkdir(deployDir, { recursive: true });
    const composeFile = path.join(deployDir, 'docker-compose.yml');

    const finalConfig = service.dockerConfig.replace(/\${APP_NAME}/g, service.appName);
    await fs.writeFile(composeFile, finalConfig);

    const envVars = this.parseEnv(service.env || '');

    let command = '';
    if (service.composeType === composeType.STACK) {
      command = `docker stack deploy -c "${composeFile}" ${service.appName}`;
    } else {
      const base = `docker compose -f "${composeFile}" -p ${service.appName}`;
      command =
        mode === 'deploy' ? `${base} up -d --build` : `${base} up -d --no-build`;
    }

    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: deployDir,
        env: { ...process.env, ...envVars },
      });

      const out = [stdout, stderr].filter((s) => s && s.trim()).join('\n');
      const err = stderr ?? '';
      /** Docker Compose writes warnings/errors to stderr; exit code can still be 0. */
      const stderrIndicatesFailure =
        /level=(warning|error|fatal)/i.test(err) ||
        /Error response from daemon/i.test(err) ||
        /Cannot connect to the Docker daemon/i.test(err);
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