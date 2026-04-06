import { spawn } from 'child_process';
import type { EventEmitter } from 'events';
import type { SpawnOptionsWithoutStdio } from 'child_process';
import * as path from 'path';

export function stderrIndicatesDockerFailure(stderr: string): boolean {
  return (
    /level=(warning|error|fatal)/i.test(stderr) ||
    /Error response from daemon/i.test(stderr) ||
    /Cannot connect to the Docker daemon/i.test(stderr) ||
    /Head\s+"https?:\/\/[^"]+":\s*(?:unauthorized|denied)/i.test(stderr) ||
    /denied:\s*requested access/i.test(stderr) ||
    /unauthorized:\s*authentication required/i.test(stderr) ||
    /no basic auth credentials/i.test(stderr)
  );
}

/** Full reason for failed `exec` / docker CLI (stderr is often dropped from `.message` alone). */
export function formatExecError(error: unknown): string {
  if (error == null) return 'Unknown error';
  if (typeof error !== 'object') return String(error);
  const e = error as {
    message?: string;
    stderr?: string;
    stdout?: string;
    code?: string | number | null;
    cmd?: string;
  };
  const lines: string[] = [];
  const head =
    e.message && String(e.message).trim()
      ? String(e.message).trim()
      : 'Command failed';
  lines.push(head);
  if (e.cmd && typeof e.cmd === 'string') {
    lines.push(`Command: ${e.cmd}`);
  }
  const errText = e.stderr != null ? String(e.stderr).trimEnd() : '';
  const outText = e.stdout != null ? String(e.stdout).trimEnd() : '';
  if (errText && !head.includes(errText.slice(0, Math.min(80, errText.length)))) {
    lines.push('');
    lines.push(errText);
  } else if (outText && !head.includes(outText.slice(0, Math.min(80, outText.length)))) {
    lines.push('');
    lines.push(outText);
  }
  if (typeof e.code === 'number' && e.code !== 0) {
    lines.push('');
    lines.push(`(exit code ${e.code})`);
  } else if (typeof e.code === 'string' && e.code && e.code !== 'OK') {
    lines.push('');
    lines.push(`(code: ${e.code})`);
  }
  return lines.join('\n');
}

export function normalizeHostPathForDockerBind(absPath: string): string {
  const resolved = path.resolve(absPath);
  if (process.platform === 'win32') {
    return resolved.replace(/\\/g, '/');
  }
  return resolved;
}

/** Emits one chunk for {@link ServicesService.executeDeployment} SSE (`deploy/stream`). */
export function emitDeployLog(emitter: EventEmitter | undefined, chunk: string): void {
  if (!emitter || !chunk) return;
  emitter.emit('data', chunk);
}

/**
 * `docker <args>` with streamed stdout/stderr (same as local `docker build` / compose on the API host).
 */
export async function spawnDockerSubcommand(
  args: string[],
  options: {
    env?: NodeJS.ProcessEnv;
    cwd?: string;
    deployLogEmitter?: EventEmitter;
  } & Pick<SpawnOptionsWithoutStdio, 'windowsHide'>,
): Promise<{ stdout: string; stderr: string }> {
  return await new Promise((resolve, reject) => {
    const child = spawn('docker', args, {
      env: options.env,
      cwd: options.cwd,
      windowsHide: options.windowsHide ?? true,
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
