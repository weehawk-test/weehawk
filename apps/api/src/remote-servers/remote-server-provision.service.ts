import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Client } from 'ssh2';
import { RemoteServer } from './entities/remote-server.entity';
import { RemoteServerProvisionJob } from './entities/remote-server-provision-job.entity';
import { RemoteServersService } from './remote-servers.service';
import {
  buildDockerPurgeScript,
  buildNixpacksOnlyInstallScript,
  buildWeehawkProvisionScript,
} from './remote-server-provision.script';
import { TraefikService } from '../traefik/traefik.service';

const MAX_LOG_CHARS = 512_000;

@Injectable()
export class RemoteServerProvisionService {
  private readonly logger = new Logger(RemoteServerProvisionService.name);
  private isProcessing = false;

  constructor(
    @InjectRepository(RemoteServerProvisionJob)
    private readonly jobRepo: Repository<RemoteServerProvisionJob>,
    private readonly remoteServersService: RemoteServersService,
    private readonly traefikService: TraefikService,
  ) {}

  /** Same bash the worker runs over SSH — for UI preview. */
  async getProvisionScriptPreview(
    role: 'deploy' | 'build',
    userId: number,
  ): Promise<{ script: string }> {
    const traefikSettings = await this.traefikService.getSettings(userId);
    return {
      script: buildWeehawkProvisionScript({
        role,
        isProvisionJobPreview: role === 'deploy',
        webhookAgent: { mode: 'none' },
        acmeEmail: traefikSettings.acmeEmail,
      }),
    };
  }

  /** Bash for full Docker removal — UI preview only; same script runs on enqueue (docker_purge job). */
  getDockerPurgeScriptPreview(): { script: string } {
    return { script: buildDockerPurgeScript() };
  }

  /** Bash run for `nixpacks_install` jobs — UI preview. */
  getNixpacksOnlyInstallScriptPreview(): { script: string } {
    return { script: buildNixpacksOnlyInstallScript() };
  }

  async enqueueProvision(
    remoteServerId: number,
    userId: number,
  ): Promise<{ jobId: string }> {
    await this.remoteServersService.findOne(remoteServerId, userId);
    const row = this.jobRepo.create({
      remoteServerId,
      userId,
      status: 'pending',
      log: '',
      jobKind: 'provision',
    });
    const saved = await this.jobRepo.save(row);
    return { jobId: saved.id };
  }

  async enqueueDockerPurge(
    remoteServerId: number,
    userId: number,
  ): Promise<{ jobId: string }> {
    await this.remoteServersService.findOne(remoteServerId, userId);
    const row = this.jobRepo.create({
      remoteServerId,
      userId,
      status: 'pending',
      log: '',
      jobKind: 'docker_purge',
    });
    const saved = await this.jobRepo.save(row);
    return { jobId: saved.id };
  }

  async enqueueNixpacksInstall(
    remoteServerId: number,
    userId: number,
  ): Promise<{ jobId: string }> {
    await this.remoteServersService.findOne(remoteServerId, userId);
    const row = this.jobRepo.create({
      remoteServerId,
      userId,
      status: 'pending',
      log: '',
      jobKind: 'nixpacks_install',
    });
    const saved = await this.jobRepo.save(row);
    return { jobId: saved.id };
  }

  async getJob(
    jobId: string,
    userId: number,
  ): Promise<{
    id: string;
    remoteServerId: number;
    jobKind: RemoteServerProvisionJob['jobKind'];
    status: RemoteServerProvisionJob['status'];
    log: string | null;
    errorMessage: string | null;
    createdAt: Date;
    updatedAt: Date;
  }> {
    const job = await this.jobRepo.findOne({ where: { id: jobId } });
    if (!job) {
      throw new NotFoundException('Provision job not found');
    }
    if (job.userId !== userId) {
      throw new NotFoundException('Provision job not found');
    }
    return {
      id: job.id,
      remoteServerId: job.remoteServerId,
      jobKind: job.jobKind ?? 'provision',
      status: job.status,
      log: job.log ?? null,
      errorMessage: job.errorMessage ?? null,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    };
  }

  /**
   * Poll from provision-worker: claim one pending job and run SSH provision.
   */
  async processNextPendingJob(): Promise<void> {
    if (this.isProcessing) {
      return;
    }
    this.isProcessing = true;
    try {
      const pending = await this.jobRepo.find({
        where: { status: 'pending' },
        order: { createdAt: 'ASC' },
        take: 1,
      });
      const job = pending[0];
      if (!job) {
        return;
      }
      await this.runProvisionJob(job.id);
    } finally {
      this.isProcessing = false;
    }
  }

  private async runProvisionJob(jobId: string): Promise<void> {
    const job = await this.jobRepo.findOne({ where: { id: jobId } });
    if (!job || job.status !== 'pending') {
      return;
    }

    const serverId = job.remoteServerId;
    const ownerId = job.userId;

    await this.jobRepo.update(
      { id: job.id },
      { status: 'running', log: '', errorMessage: null },
    );

    /** In-memory log buffer; persist with `update` only — avoid `save({ id, log })` wiping `job_kind` in TypeORM. */
    let logBuf = '';

    const appendLog = async (chunk: string) => {
      if (!chunk) return;
      logBuf = (logBuf + chunk).slice(-MAX_LOG_CHARS);
      await this.jobRepo.update({ id: job.id }, { log: logBuf });
    };

    try {
      const kind = await this.resolveJobKindFromDb(job.id);

      const ctx = await this.remoteServersService.getSshProvisionContext(serverId, ownerId);
      let script: string;
      if (kind === 'docker_purge') {
        script = buildDockerPurgeScript();
      } else if (kind === 'nixpacks_install') {
        script = buildNixpacksOnlyInstallScript();
      } else {
        const webhookAgent =
          ctx.server.serverRole === 'build'
            ? undefined
            : await this.remoteServersService.getWebhookAgentProvisionInput();
        const traefikSettings = await this.traefikService.getSettings(ownerId);
        script = buildWeehawkProvisionScript({
          role: ctx.server.serverRole === 'build' ? 'build' : 'deploy',
          webhookAgent,
          isProvisionJobPreview: false,
          acmeEmail: traefikSettings.acmeEmail,
        });
      }
      this.logger.log(
        `Job ${job.id} remote_server_id=${serverId} resolved job_kind=${kind} (from DB column job_kind)`,
      );
      await appendLog(
        `[Weehawk] job_kind=${kind}\n` +
          `\n--- SSH ${ctx.server.host}:${ctx.server.port} (${ctx.server.sshUser}) [${kind}] ---\n`,
      );
      await this.execSshBashScript(ctx.server, ctx.privateKeyPem, script, (s) =>
        void appendLog(s),
      );
      await this.jobRepo.update({ id: job.id }, { status: 'done', errorMessage: null });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`Remote server job ${jobId} failed: ${msg}`);
      await this.jobRepo.update({ id: job.id }, { status: 'error', errorMessage: msg });
    }
  }

  /**
   * Read `job_kind` with QueryBuilder so mapping issues cannot pick the wrong script.
   * Kinds: `provision`, `docker_purge`, `nixpacks_install`.
   */
  private async resolveJobKindFromDb(
    jobId: string,
  ): Promise<'provision' | 'docker_purge' | 'nixpacks_install'> {
    const raw = await this.jobRepo
      .createQueryBuilder('j')
      .select('j.job_kind', 'jobKind')
      .where('j.id = :id', { id: jobId })
      .getRawOne<{ jobKind: string | null }>();
    const k = raw?.jobKind?.trim();
    if (k === 'docker_purge') return 'docker_purge';
    if (k === 'nixpacks_install') return 'nixpacks_install';
    return 'provision';
  }

  private async execSshBashScript(
    server: RemoteServer,
    privateKeyPem: string,
    script: string,
    onData?: (chunk: string) => void,
  ): Promise<void> {
    const client = new Client();
    const connectOpts = this.remoteServersService.getSsh2ConnectOptions(
      server,
      privateKeyPem,
      120_000,
    );
    return new Promise((resolve, reject) => {
      client
        .once('ready', () => {
          void this.remoteServersService.flushPendingSshHostKeyFingerprint(server.id).then(() => {
            client.exec('bash -s', (err, stream) => {
              if (err) {
                reject(err);
                return;
              }
              let stderr = '';
              stream.on('close', (code: number) => {
                client.end();
                if (code === 0) {
                  resolve();
                } else {
                  reject(
                    new BadRequestException(
                      stderr.trim()
                        ? `Remote script failed (exit ${code}): ${stderr.trim().slice(0, 2000)}`
                        : `Remote script exited with code ${code}`,
                    ),
                  );
                }
              });
              stream.on('data', (d: Buffer) => onData?.(d.toString()));
              stream.stderr.on('data', (d: Buffer) => {
                const s = d.toString();
                stderr += s;
                onData?.(s);
              });
              stream.write(script);
              stream.end();
            });
          });
        })
        .on('error', (err: Error & { level?: string }) => {
          this.remoteServersService.clearPendingSshHostKeyForServer(server.id);
          client.end();
          if (err.level === 'client-authentication') {
            reject(
              new BadRequestException(
                'SSH authentication failed — check the private key matches authorized_keys on the server.',
              ),
            );
          } else {
            reject(err);
          }
        })
        .connect(connectOpts);
    });
  }
}
