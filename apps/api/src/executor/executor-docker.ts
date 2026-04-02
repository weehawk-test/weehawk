import { spawn } from 'child_process';
import type { EventEmitter } from 'events';
import * as path from 'path';

export function stderrIndicatesDockerFailure(stderr: string): boolean {
  return (
    /level=(warning|error|fatal)/i.test(stderr) ||
    /Error response from daemon/i.test(stderr) ||
    /Cannot connect to the Docker daemon/i.test(stderr)
  );
}

export function normalizeHostPathForDockerBind(absPath: string): string {
  const resolved = path.resolve(absPath);
  if (process.platform === 'win32') {
    return resolved.replace(/\\/g, '/');
  }
  return resolved;
}

function emitDeployLog(emitter: EventEmitter | undefined, chunk: string): void {
  if (!emitter || !chunk) return;
  emitter.emit('data', chunk);
}

/**
 * Runs `docker` on the host with streamed logs; build tools execute inside the child container only.
 */
export async function spawnDocker(
  dockerArgs: string[],
  options: {
    env: NodeJS.ProcessEnv;
    deployLogEmitter?: EventEmitter;
  },
): Promise<{ stdout: string; stderr: string }> {
  return await new Promise((resolve, reject) => {
    const child = spawn('docker', dockerArgs, {
      env: options.env,
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (buf: Buffer) => {
      const s = buf.toString();
      stdout += s;
      emitDeployLog(options.deployLogEmitter, s);
    });
    child.stderr?.on('data', (buf: Buffer) => {
      const s = buf.toString();
      stderr += s;
      emitDeployLog(options.deployLogEmitter, s);
    });
    child.on('error', (err) => reject(err));
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(
          new Error(
            `docker exited with code ${code}${stderr ? `: ${stderr.slice(-4000)}` : ''}`,
          ),
        );
      }
    });
  });
}
