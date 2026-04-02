import { exec } from 'child_process';
import { promisify } from 'util';
import { Service } from '../services/entities/service.entity';
import { composeType } from '../services/entities/composeType.enum';

const execAsync = promisify(exec);

/** Swarm stack deploy path (same CLI as explicit Stack services + database-generated YAML). */
export function isSwarmStackService(service: Service): boolean {
  return (
    service.composeType === composeType.STACK ||
    service.composeType === composeType.DATABASES ||
    service.composeType === composeType.APPLICATION
  );
}

/**
 * Rolling restart every Swarm service in a stack (same compose file, tasks recreated).
 */
export async function forceRollingRestartStackServices(stackName: string): Promise<{
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

/**
 * Swarm service names are `stackname_servicekey`, not the stack name alone.
 * Lists `docker stack services` and scales each to 0.
 */
export async function scaleAllStackServicesToZero(stackName: string): Promise<void> {
  let stdout: string;
  try {
    const r = await execAsync(
      `docker stack services ${stackName} --format "{{.Name}}"`,
      { maxBuffer: 10 * 1024 * 1024 },
    );
    stdout = r.stdout;
  } catch {
    return;
  }
  const names = stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  for (const name of names) {
    await execAsync(`docker service scale ${name}=0`, {
      maxBuffer: 10 * 1024 * 1024,
    });
  }
}
