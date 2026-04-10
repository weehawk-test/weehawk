import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Client } from 'ssh2';
import { RemoteServerProvisionJob } from './entities/remote-server-provision-job.entity';
import { RemoteServersService } from './remote-servers.service';
import {
  buildDockerPurgeScript,
  buildWeehawkProvisionScript,
} from './remote-server-provision.script';

const MAX_LOG_CHARS = 512_000;

@Injectable()
export class RemoteServerProvisionService {
  private readonly logger = new Logger(RemoteServerProvisionService.name);
  private isProcessing = false;

  constructor(
    @InjectRepository(RemoteServerProvisionJob)
    private readonly jobRepo: Repository<RemoteServerProvisionJob>,
    private readonly remoteServersService: RemoteServersService,
  ) {}

  /** Same bash the worker runs over SSH — for UI preview. */
  getProvisionScriptPreview(role: 'deploy' | 'build'): { script: string } {
    return {
      script: buildWeehawkProvisionScript({
        role,
        isProvisionJobPreview: role === 'deploy',
        webhookAgent: { mode: 'none' },
      }),
    };
  }

  /** Bash for full Docker removal — UI preview only; same script runs on enqueue (docker_purge job). */
  getDockerPurgeScriptPreview(): { script: string } {
    return { script: buildDockerPurgeScript() };
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
      const webhookAgent =
        ctx.server.serverRole === 'build'
          ? undefined
          : await this.remoteServersService.getWebhookAgentProvisionInput();
      const script =
        kind === 'docker_purge'
          ? buildDockerPurgeScript()
          : buildWeehawkProvisionScript({
              role: ctx.server.serverRole === 'build' ? 'build' : 'deploy',
              webhookAgent,
              isProvisionJobPreview: false,
            });
      this.logger.log(
        `Job ${job.id} remote_server_id=${serverId} resolved job_kind=${kind} (from DB column job_kind)`,
      );
      await appendLog(
        `[Weehawk] job_kind=${kind}\n` +
          `\n--- SSH ${ctx.server.host}:${ctx.server.port} (${ctx.server.sshUser}) [${kind}] ---\n`,
      );
      await this.execSshBashScript(
        {
          host: ctx.server.host.trim(),
          port: ctx.server.port ?? 22,
          username: ctx.server.sshUser.trim(),
          privateKey: Buffer.from(ctx.privateKeyPem, 'utf8'),
        },
        script,
        (s) => void appendLog(s),
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
   * If this returns `provision` for a purge you queued, check the worker is rebuilt and uses the same DB as the API.
   */
  private async resolveJobKindFromDb(
    jobId: string,
  ): Promise<'provision' | 'docker_purge'> {
    const raw = await this.jobRepo
      .createQueryBuilder('j')
      .select('j.job_kind', 'jobKind')
      .where('j.id = :id', { id: jobId })
      .getRawOne<{ jobKind: string | null }>();
    const k = raw?.jobKind?.trim();
    return k === 'docker_purge' ? 'docker_purge' : 'provision';
  }

  private async execSshBashScript(
    opts: {
      host: string;
      port: number;
      username: string;
      privateKey: Buffer;
    },
    script: string,
    onData?: (chunk: string) => void,
  ): Promise<void> {
    const client = new Client();
    return new Promise((resolve, reject) => {
      client
        .once('ready', () => {
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
        })
        .on('error', (err: Error & { level?: string }) => {
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
        .connect({
          host: opts.host,
          port: opts.port,
          username: opts.username,
          privateKey: opts.privateKey,
          readyTimeout: 120_000,
          hostVerifier: () => true,
        });
    });
  }
}
