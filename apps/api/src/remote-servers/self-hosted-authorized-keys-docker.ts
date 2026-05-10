import * as fs from 'fs/promises';
import * as path from 'path';
import { constants as fsConstants } from 'fs';
import Dockerode from 'dockerode';
import type { Logger } from '@nestjs/common';

const ALPINE_IMAGE = 'alpine:3.20';

/** Default: bind the Docker host's `/root/.ssh` here in the API compose file (rw). */
export const DEFAULT_SELF_HOSTED_MOUNTED_AUTHORIZED_KEYS =
  '/weehawk/docker-host-root-ssh/authorized_keys';

export type SelfHostedAuthorizedKeysInjectConfig = {
  /**
   * Absolute path **inside the API container** to `authorized_keys` on the real SSH host.
   * Typical compose: `- /root/.ssh:/weehawk/docker-host-root-ssh:rw`
   */
  mountedAuthorizedKeysPath: string;
  /**
   * Host-side directory passed to `docker run -v <dir>:/root/.ssh` when the mount above is not used.
   * On some Docker Desktop setups `/root/.ssh` refers to the utility VM, not the distro where sshd runs.
   */
  dockerHostSshBind: string;
};

function dockerSocketPath(): string {
  const raw = process.env.DOCKER_HOST?.trim() ?? '';
  if (raw.startsWith('unix://')) return raw.slice('unix://'.length);
  return '/var/run/docker.sock';
}

async function ensureImageLocal(docker: Dockerode, image: string): Promise<void> {
  try {
    const img = docker.getImage(image);
    await img.inspect();
    return;
  } catch {
    /* pull */
  }
  await new Promise<void>((resolve, reject) => {
    docker.pull(image, {}, (err, stream) => {
      if (err) {
        reject(err);
        return;
      }
      if (!stream) {
        reject(new Error('Docker pull: empty stream'));
        return;
      }
      type Modem = { followProgress: typeof docker.modem.followProgress };
      (docker.modem as Modem).followProgress(
        stream,
        (progErr: Error | null | undefined) => {
          if (progErr) reject(progErr);
          else resolve();
        },
        () => undefined,
      );
    });
  });
}

/**
 * Append one line to a bind-mounted `authorized_keys` file (same inode the host sshd reads).
 */
async function isLinuxBindMountPoint(dir: string): Promise<boolean> {
  try {
    const abs = path.normalize(path.resolve(dir));
    const text = await fs.readFile('/proc/mounts', 'utf8');
    for (const raw of text.split('\n')) {
      if (!raw) continue;
      const parts = raw.split(' ');
      if (parts.length < 4) continue;
      const mp = path.normalize(
        parts[1]?.replace(/\\040/g, ' ') ?? '',
      );
      if (mp === abs) return true;
    }
  } catch {
    /* non-Linux container or no /proc */
  }
  return false;
}

async function tryAppendViaBindMount(
  authorizedKeysPath: string,
  line: string,
  log: Logger,
): Promise<boolean> {
  const abs = path.resolve(authorizedKeysPath);
  const parent = path.dirname(abs);
  try {
    await fs.access(parent, fsConstants.F_OK);
  } catch {
    return false;
  }
  const mounted = await isLinuxBindMountPoint(parent);
  let authExists = false;
  try {
    await fs.access(abs, fsConstants.F_OK);
    authExists = true;
  } catch {
    /* new file */
  }
  if (!mounted && !authExists) {
    return false;
  }
  if (!mounted && authExists) {
    /* file shipped in image — do not touch */
    return false;
  }
  try {
    await fs.access(parent, fsConstants.W_OK);
  } catch {
    log.warn(
      `Self-hosted: path ${parent} is not writable from the API container — fix volume permissions or mount options.`,
    );
    return false;
  }

  let existing = '';
  try {
    existing = await fs.readFile(abs, 'utf8');
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') {
      log.warn(
        `Self-hosted: cannot read ${abs}: ${e instanceof Error ? e.message : String(e)}`,
      );
      return false;
    }
  }

  const normalized = existing.replace(/\r\n/g, '\n');
  const existingLines = normalized
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  if (existingLines.includes(line)) {
    log.log(
      `Self-hosted: SSH public key already present in ${abs} (bind mount).`,
    );
    return true;
  }

  const toWrite =
    (normalized.length > 0 && !normalized.endsWith('\n') ? '\n' : '') +
    `${line}\n`;
  try {
    await fs.appendFile(abs, toWrite, 'utf8');
  } catch (e) {
    log.warn(
      `Self-hosted: cannot append to ${abs}: ${e instanceof Error ? e.message : String(e)}`,
    );
    return false;
  }
  log.log(`Self-hosted: appended SSH public key to ${abs} (bind mount).`);
  return true;
}

async function injectViaEphemeralContainer(
  line: string,
  log: Logger,
  hostSshBind: string,
): Promise<boolean> {
  const sock = dockerSocketPath();
  try {
    await fs.access(sock);
  } catch {
    log.warn(
      `Self-hosted: no Docker socket at ${sock} — cannot inject via helper container. Mount the socket, or bind-mount the host's .ssh directory into the API at ${DEFAULT_SELF_HOSTED_MOUNTED_AUTHORIZED_KEYS.replace(/\/authorized_keys$/, '')}.`,
    );
    return false;
  }

  const bindSource = hostSshBind.trim() || '/root/.ssh';
  const docker = new Dockerode({ socketPath: sock });
  await ensureImageLocal(docker, ALPINE_IMAGE);

  const b64 = Buffer.from(line, 'utf8').toString('base64');
  const shellBody = [
    'set -eu',
    'mkdir -p /root/.ssh',
    'chmod 700 /root/.ssh',
    'LINE=$(printf "%s" "$KEY_B64" | base64 -d)',
    'test -f /root/.ssh/authorized_keys || : > /root/.ssh/authorized_keys',
    'chmod 600 /root/.ssh/authorized_keys',
    'if grep -qxF "$LINE" /root/.ssh/authorized_keys 2>/dev/null; then',
    '  echo "weehawk: public key already in root authorized_keys"',
    '  exit 0',
    'fi',
    'printf "%s\\n" "$LINE" >> /root/.ssh/authorized_keys',
    'echo "weehawk: appended public key to root authorized_keys"',
  ].join('\n');

  const container = await docker.createContainer({
    Image: ALPINE_IMAGE,
    Env: [`KEY_B64=${b64}`],
    Cmd: ['sh', '-c', shellBody],
    HostConfig: {
      Binds: [`${bindSource}:/root/.ssh`],
      AutoRemove: false,
      NetworkMode: 'none',
    },
    User: '0:0',
  });

  await container.start();
  const wait = await container.wait();
  let logText = '';
  try {
    const buf = await container.logs({
      stdout: true,
      stderr: true,
      tail: 50,
    });
    logText = buf.toString('utf8').replace(/\0/g, '');
  } catch {
    /* ignore */
  }
  await container.remove({ force: true }).catch(() => undefined);

  const code = wait.StatusCode ?? -1;
  if (code !== 0) {
    throw new Error(
      `Helper container exit ${code}. Bind source was "${bindSource}:/root/.ssh". Logs: ${logText.trim() || '(empty)'}`,
    );
  }
  log.log(
    `Self-hosted: appended SSH public key via Docker bind ${bindSource} -> /root/.ssh. ${logText.trim()}`,
  );
  return true;
}

/**
 * Prefer a direct bind-mounted `authorized_keys` (reliable with Docker Desktop / WSL),
 * otherwise run a short-lived container with `-v <hostDir>:/root/.ssh`.
 */
export async function injectSelfHostedBootstrapAuthorizedKey(
  publicKeyLine: string,
  log: Logger,
  config: SelfHostedAuthorizedKeysInjectConfig,
): Promise<void> {
  const line = publicKeyLine.trim();
  if (!line) {
    throw new Error('Public key line is empty');
  }

  const mounted = await tryAppendViaBindMount(
    config.mountedAuthorizedKeysPath,
    line,
    log,
  );
  if (mounted) {
    return;
  }

  const viaDocker = await injectViaEphemeralContainer(
    line,
    log,
    config.dockerHostSshBind,
  );
  if (!viaDocker) {
    throw new Error(
      'authorized_keys was not updated: add a bind-mount for the host .ssh directory (recommended) or expose the Docker socket to the API.',
    );
  }
}
