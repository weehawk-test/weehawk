import {
  BadRequestException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  forwardRef,
  Inject,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import * as fs from 'fs/promises';
import { tmpdir } from 'os';
import * as path from 'path';
import { ServicesService } from '../services/services.service';
import { composeType } from '../services/entities/composeType.enum';
import { Service } from '../services/entities/service.entity';
import type { ServiceVolumesResponseDto } from '../services/dto/service-volume-mount.dto';
import {
  getServiceDeploymentDir,
  toSafePathSegment,
} from '../services/deployment-paths';
import { resolveEffectiveDockerfileRel } from '../services/weehawk-build-paths';
import { maybeRemoveApplicationSourceAfterDeploy } from './executor-app-source';
import {
  firstComposeServiceName,
  firstImageRefFromComposeYaml,
  parseConfigHeaderValue,
  parseEnv,
  resolveNixpacksNodeMajorForRemoteBuild,
} from './executor-compose-parse';
import { removeDeploymentFolder } from './executor-deployment-fs';
import {
  emitDeployLog,
  formatExecError,
  stderrIndicatesDockerFailure,
} from './executor-docker';
import type { ExecuteDeployOptions } from './executor-types';
import { isSwarmStackService } from './executor-swarm';
import { flattenVolumesFromComposeJson } from './executor-volumes';
import { runStructuredDatabaseBackupOnRemoteHost } from './executor-structured-db-backup';
import {
  runStructuredDatabaseImport,
  type StructuredDbImportDocker,
} from './executor-structured-db-import';
import {
  assertSafeComposeService,
  type DatabaseBackupConfig,
} from '../backup/database-backup.types';
import {
  RemoteServersService,
  WEEHAWK_REMOTE_DEPLOYMENTS_BASE,
} from '../remote-servers/remote-servers.service';
import { RegistryService } from '../registry/registry.service';
import { bashGithubInstallationTokenMutateUrl } from '../common/github-install-token-bash';

export type { ExecuteDeployOptions } from './executor-types';

/** Swarm stacks are deployed over SSH; without a deploy host, do not call local `docker` (avoids Windows Docker Desktop / npipe errors on the API PC). */
const SWARM_NEEDS_DEPLOY_HOST_MESSAGE =
  'Configure a deploy SSH server for this service (Remote / deploy host) first.';

const COMPOSE_NEEDS_DEPLOY_HOST_MESSAGE =
  'No deploy host is set for this compose service. Choose a remote Deploy server under Remote Docker host, save, then try again.';

/** Keep runtime checks responsive without flapping to false on normal SSH latency. */
const RUNTIME_STATUS_TIMEOUT_MS = 5_000;

function remoteHostPublicLabel(
  service: Service,
  remoteServerId: number | null | undefined,
): string {
  if (remoteServerId == null) return 'remote-host';
  const fromBuild =
    service.buildRemoteServer && service.buildRemoteServerId === remoteServerId
      ? service.buildRemoteServer.publicId
      : null;
  const fromDeploy =
    service.remoteServer && service.remoteServerId === remoteServerId
      ? service.remoteServer.publicId
      : null;
  const publicId = (fromBuild ?? fromDeploy ?? '').trim();
  return publicId || 'remote-host';
}

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

/**
 * Bash fragment: run in the Nixpacks build context directory before `nixpacks build`.
 * - Allowlist `.dockerignore` can hide `.nixpacks/` from Docker; we temporarily move `.dockerignore` aside.
 * - `--no-cache` + fresh `.nixpacks/` + explicit `--env NIXPACKS_NODE_VERSION=…` avoids stale nodejs_18
 *   plans (export alone is not always applied during `nixpacks plan` on some hosts).
 */
const NIXPACKS_BUILD_CLI_TAIL = '--no-cache';

const NIXPACKS_ENSURE_DOT_NIXPACKS_IN_DOCKER_CONTEXT = `
weehawk_nixpacks_restore_dockerignore() {
  if [ -f .dockerignore.weehawk-nixpacks-bak ]; then
    mv -f .dockerignore.weehawk-nixpacks-bak .dockerignore
  fi
}
trap weehawk_nixpacks_restore_dockerignore EXIT
if [ -f .dockerignore ]; then
  mv -f .dockerignore .dockerignore.weehawk-nixpacks-bak
fi
`.trim();

@Injectable()
export class ExecutorService {
  private readonly logger = new Logger(ExecutorService.name);

  constructor(
    @Inject(forwardRef(() => ServicesService))
    private readonly servicesService: ServicesService,
    private readonly configService: ConfigService,
    private readonly remoteServersService: RemoteServersService,
    private readonly registryService: RegistryService,
  ) {}

  /**
   * SSH `git clone` on the remote host: optional GitHub App JWT exchange (same as on-host redeploy)
   * so private repos never rely on an unauthenticated `https://github.com/...` URL.
   */
  private remoteGitCloneScriptBody(
    shQ: (s: string) => string,
    remoteSourceRoot: string,
    ref: string,
    cloneUrl: string,
    githubBashAuth?: {
      appId: string;
      installationId: number;
      pemBase64: string;
    },
  ): string {
    const ghBlock =
      githubBashAuth != null
        ? `_GH_APP=${shQ(githubBashAuth.appId)}
_GH_INST=${shQ(String(githubBashAuth.installationId))}
_GH_PEM=${shQ(githubBashAuth.pemBase64)}
${bashGithubInstallationTokenMutateUrl('URL', 'Weehawk deploy')}
`
        : '';
    return `set -euo pipefail
TARGET=${shQ(remoteSourceRoot)}
BR=${shQ(ref)}
URL=${shQ(cloneUrl)}
${ghBlock}mkdir -p "$(dirname "$TARGET")"
if ! command -v git >/dev/null 2>&1; then
  echo "git is not installed on deploy host."
  exit 24
fi
if [ -d "$TARGET/.git" ]; then
  git -C "$TARGET" remote set-url origin "$URL" || true
  git -C "$TARGET" fetch --depth 1 origin "$BR"
  git -C "$TARGET" checkout -B "$BR" "origin/$BR"
  git -C "$TARGET" reset --hard "origin/$BR"
  git -C "$TARGET" clean -fdx || true
else
  rm -rf "$TARGET"
  git clone --depth 1 --branch "$BR" "$URL" "$TARGET"
fi
`;
  }

  /** Resolve Git clone URL for application services with `app.git.remoteOnly`. */
  private async resolveApplicationRemoteGitCloneParams(
    service: Service,
    rawConfig: string,
  ): Promise<{
    isRemoteGit: boolean;
    cloneUrl: string | null;
    ref: string;
    gitProviderLabel: string | undefined;
    githubBashAuth?: {
      appId: string;
      installationId: number;
      pemBase64: string;
    };
  }> {
    const isRemoteGit =
      parseConfigHeaderValue(rawConfig, 'app.git.remoteOnly') === 'true';
    const ref =
      parseConfigHeaderValue(rawConfig, 'app.git.ref')?.trim() || 'main';
    let cloneUrl: string | null = null;
    let gitProviderLabel: string | undefined;
    let githubBashAuth:
      | { appId: string; installationId: number; pemBase64: string }
      | undefined;
    if (isRemoteGit) {
      gitProviderLabel = parseConfigHeaderValue(
        rawConfig,
        'app.git.provider',
      )?.trim();
      const ownerUserIdRaw = service.project?.userId;
      if (!ownerUserIdRaw || ownerUserIdRaw < 1) {
        throw new InternalServerErrorException(
          'Remote Git application source requires a service linked to a project with a valid owner user id.',
        );
      }
      const ownerUserId = ownerUserIdRaw;
      if (gitProviderLabel === 'gitlab') {
        const glProjectId = parseInt(
          parseConfigHeaderValue(rawConfig, 'app.git.gitlabProjectId') || '',
          10,
        );
        if (Number.isFinite(glProjectId) && glProjectId > 0) {
          cloneUrl = await this.servicesService.resolveGitlabProjectCloneUrl(
            glProjectId,
            ownerUserId,
          );
        } else {
          const httpUrl = parseConfigHeaderValue(
            rawConfig,
            'app.git.httpUrlToRepo',
          )?.trim();
          if (httpUrl) {
            cloneUrl = await this.servicesService.resolveGitlabAuthenticatedUrl(
              httpUrl,
              ownerUserId,
            );
          }
        }
      } else if (gitProviderLabel === 'github') {
        const ghInstallationId = parseInt(
          parseConfigHeaderValue(rawConfig, 'app.git.githubInstallationId') ||
            '',
          10,
        );
        const ghFullName = parseConfigHeaderValue(
          rawConfig,
          'app.git.githubRepoFullName',
        )?.trim();
        if (
          ghFullName &&
          Number.isFinite(ghInstallationId) &&
          ghInstallationId > 0
        ) {
          const ghCreds =
            await this.servicesService.getGithubAppCredentials(ownerUserId);
          if (!ghCreds?.appId?.trim() || !ghCreds?.privateKeyPem?.trim()) {
            throw new InternalServerErrorException(
              'GitHub App is not configured for this project owner in Weehawk (Git → GitHub: App ID and private key, while signed in as the same user who owns the project). Required to clone GitHub repositories on the deploy host.',
            );
          }
          const slug = ghFullName.replace(/\.git$/i, '').replace(/^\/+/, '');
          cloneUrl = `https://github.com/${slug}.git`;
          githubBashAuth = {
            appId: ghCreds.appId.trim(),
            installationId: ghInstallationId,
            pemBase64: Buffer.from(ghCreds.privateKeyPem.trim()).toString(
              'base64',
            ),
          };
        } else if (ghFullName) {
          cloneUrl = `https://github.com/${ghFullName.replace(/\.git$/i, '').replace(/^\/+/, '')}.git`;
        } else {
          const httpUrl = parseConfigHeaderValue(
            rawConfig,
            'app.git.httpUrlToRepo',
          )?.trim();
          if (httpUrl) cloneUrl = httpUrl;
        }
      }
    }
    return { isRemoteGit, cloneUrl, ref, gitProviderLabel, githubBashAuth };
  }

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
    const projectUserId: number | null = service.project?.userId ?? null;
    const projectOrganizationId: number | null =
      service.project?.organizationId ?? null;
    return this.remoteServersService.mergeDockerHostEnvForDeployIds(
      base,
      ids.remoteServerId,
      projectUserId,
      projectOrganizationId,
    );
  }

  private async withRuntimeTimeout<T>(op: Promise<T>): Promise<T> {
    return await Promise.race([
      op,
      new Promise<T>((_, reject) => {
        setTimeout(
          () => reject(new Error('Runtime check timed out')),
          RUNTIME_STATUS_TIMEOUT_MS,
        );
      }),
    ]);
  }

  /** `${APP_NAME}` substitution plus DATABASES fixes (Postgres 18+ expects mount at `/var/lib/postgresql`). */
  private composeYamlForResolvedDeploy(service: Service): string {
    let c = (service.dockerConfig || '').replace(
      /\${APP_NAME}/g,
      service.appName,
    );
    if (service.composeType === composeType.DATABASES) {
      c = c.replace(/\/var\/lib\/postgresql\/data/g, '/var/lib/postgresql');
    }
    return c;
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
    const service = await this.servicesService.internalFindOneById(id);
    const sshTargets = await this.servicesService.getDockerSshTargetIds(
      service.id,
    );
    const projectUserId: number | null = service.project?.userId ?? null;
    const projectOrganizationId: number | null =
      service.project?.organizationId ?? null;
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

    const deployDir = getServiceDeploymentDir(service.appName, service.id);
    const finalConfig = this.composeYamlForResolvedDeploy(service);

    if (sshTargets.remoteServerId != null && !isSwarmStackService(service)) {
      await this.remoteServersService.mirrorDockerComposeToRemotePersistent(
        sshTargets.remoteServerId,
        projectUserId,
        {
          composeYaml: finalConfig,
          projectName: service.appName || 'service',
        },
      );
    }

    const needsLocalSourceTree =
      isSwarmStackService(service) &&
      service.composeType === composeType.APPLICATION;
    if (needsLocalSourceTree) {
      await fs.mkdir(deployDir, { recursive: true });
    }

    const execOpts = {
      cwd: needsLocalSourceTree ? deployDir : tmpdir(),
      env: await this.getProcessEnvForService(service),
    };
    const deployLogEmitter = options?.deployLogEmitter;
    const emitChunk = (chunk: string) => emitDeployLog(deployLogEmitter, chunk);
    const shQ = (s: string) => `'${String(s).replace(/'/g, `'\\''`)}'`;
    try {
      if (isSwarmStackService(service)) {
        let buildLogPrefix = '';
        if (service.composeType === composeType.APPLICATION) {
          const deployMode =
            parseConfigHeaderValue(rawConfig, 'deployMode')?.toLowerCase() ||
            'source';
          const sourceDir =
            parseConfigHeaderValue(rawConfig, 'sourceDir') || 'app-source';
          const buildPath =
            parseConfigHeaderValue(rawConfig, 'buildPath') || '.';
          const dockerfilePath =
            parseConfigHeaderValue(rawConfig, 'dockerfilePath') || 'Dockerfile';
          const registryPush = parseConfigHeaderValue(
            rawConfig,
            'registry.pushImage',
          )?.trim();
          const defaultTag = `${service.appName}:latest`;
          const imageTag = registryPush?.length ? registryPush : defaultTag;
          const buildModeHeader =
            parseConfigHeaderValue(rawConfig, 'buildMode')?.toLowerCase() ||
            'dockerfile';
          const isNixpacksBuild =
            buildModeHeader === 'nixpacks' || buildModeHeader === 'buildpacks';
          const sourceRoot = path.join(deployDir, sourceDir);
          const fullContext = path.join(deployDir, sourceDir, buildPath);
          const sourceRootExists = await fs
            .access(sourceRoot)
            .then(() => true)
            .catch(() => false);
          /* Start (`execute(..., 'reload')` from startContainers) must not rebuild — only reapply the stack. */
          if (mode !== 'reload' && deployMode !== 'image' && sourceRootExists) {
            const sshIds = await this.servicesService.getDockerSshTargetIds(
              service.id,
            );
            const buildBase = await this.getBaseProcessEnvForService(service);
            const buildEnv =
              await this.remoteServersService.mergeDockerHostEnvForBuildIds(
                buildBase,
                {
                  buildRemoteServerId: sshIds.buildRemoteServerId,
                  remoteServerId: sshIds.remoteServerId,
                  buildOnLocalDockerHost: sshIds.buildOnLocalDockerHost,
                },
                projectUserId,
                projectOrganizationId,
              );
            const useRemoteDockerBuild = Boolean(pickDockerSshEnv(buildEnv));
            const buildRemoteServerId =
              sshIds.buildRemoteServerId ?? sshIds.remoteServerId;
            if (!isNixpacksBuild || !useRemoteDockerBuild) {
              await fs.access(fullContext).catch(() => {
                throw new InternalServerErrorException(
                  `Application build path not found: "${buildPath}" under ${sourceDir}.`,
                );
              });
            }
            if (useRemoteDockerBuild) {
              if (buildRemoteServerId == null) {
                throw new InternalServerErrorException(
                  'Remote Docker build is enabled but no remote server id was resolved for this service.',
                );
              }
              const buildHostLabel = remoteHostPublicLabel(
                service,
                buildRemoteServerId,
              );
              if (isNixpacksBuild) {
                const gitParams =
                  await this.resolveApplicationRemoteGitCloneParams(
                    service,
                    rawConfig,
                  );
                if (!gitParams.isRemoteGit || !gitParams.cloneUrl) {
                  return {
                    success: false,
                    output:
                      'Nixpacks builds on the remote host require a linked Git repository (source is cloned on the build machine only). The Weehawk API does not upload application source. Link GitHub or GitLab under Application source, or use Dockerfile build mode if you need another workflow.',
                  };
                }
                const { cloneUrl, ref, gitProviderLabel, githubBashAuth } =
                  gitParams;
                const persist = `${WEEHAWK_REMOTE_DEPLOYMENTS_BASE}/${toSafePathSegment(service.appName || 'service')}`;
                const remoteSourceRoot = `${persist}/${sourceDir.replace(/\\/g, '/')}`;
                const remoteBuildPathSeg = buildPath.replace(/\\/g, '/');
                const remoteContext =
                  remoteBuildPathSeg === '.' || remoteBuildPathSeg === ''
                    ? remoteSourceRoot
                    : `${remoteSourceRoot}/${remoteBuildPathSeg}`;
                emitChunk(
                  `Cloning ${gitProviderLabel ?? 'git'} repository on build host ${buildHostLabel} (branch: ${ref}) for Nixpacks…\n`,
                );
                const remoteCloneScript = this.remoteGitCloneScriptBody(
                  shQ,
                  remoteSourceRoot,
                  ref,
                  cloneUrl,
                  githubBashAuth,
                );
                await this.remoteServersService.execDockerCliOnRemoteViaSsh(
                  buildRemoteServerId,
                  projectUserId,
                  remoteCloneScript,
                  deployLogEmitter ? emitChunk : undefined,
                );
                emitChunk(
                  `Building image with Nixpacks on remote host ${buildHostLabel} (${remoteContext})…\n`,
                );
                const nixNodeMajor =
                  resolveNixpacksNodeMajorForRemoteBuild(rawConfig);
                const nixNodeExport = `export NIXPACKS_NODE_VERSION=${shQ(nixNodeMajor)}\n`;
                const remoteNixpacksScript = `set -euo pipefail
CTX=${shQ(remoteContext)}
export PATH="$PATH:$HOME/.local/bin:/root/.local/bin:/usr/local/bin"
${nixNodeExport}if [ ! -d "$CTX" ]; then
  echo "Build context not found on remote after clone: $CTX" >&2
  exit 22
fi
if ! command -v nixpacks >/dev/null 2>&1; then
  echo "nixpacks: command not found. Re-run Weehawk Install on this host (includes Nixpacks CLI)." >&2
  exit 127
fi
cd "$CTX"
${NIXPACKS_ENSURE_DOT_NIXPACKS_IN_DOCKER_CONTEXT}
rm -rf .nixpacks
nixpacks build . --name ${shQ(imageTag)} --env ${shQ(`NIXPACKS_NODE_VERSION=${nixNodeMajor}`)} ${NIXPACKS_BUILD_CLI_TAIL}
`;
                const np =
                  await this.remoteServersService.execDockerCliOnRemoteViaSsh(
                    buildRemoteServerId,
                    projectUserId,
                    remoteNixpacksScript,
                    deployLogEmitter ? emitChunk : undefined,
                  );
                buildLogPrefix = [np.stdout, np.stderr]
                  .filter((s) => s?.trim())
                  .join('\n');
                if (buildLogPrefix) emitChunk(`${buildLogPrefix}\n`);
              } else {
                const { relativePath: dockerfileRel } =
                  await resolveEffectiveDockerfileRel(
                    fullContext,
                    dockerfilePath,
                  );
                const fullDockerfile = path.join(
                  fullContext,
                  ...dockerfileRel.split('/'),
                );
                await fs.access(fullDockerfile).catch(() => {
                  throw new InternalServerErrorException(
                    `Dockerfile not found for build: "${dockerfileRel}" under build context.`,
                  );
                });
                const dockerfilePosix = dockerfileRel.split(/[/\\]/).join('/');
                emitChunk(`Building image on remote host ${buildHostLabel}…\n`);
                const buildResult =
                  await this.remoteServersService.buildImageUsingDockerodeSsh(
                    buildRemoteServerId,
                    {
                      contextPath: fullContext,
                      dockerfilePosix,
                      tag: imageTag,
                    },
                    projectUserId,
                    projectOrganizationId,
                  );
                buildLogPrefix = buildResult.output
                  ? `${buildResult.output}\n`
                  : '';
                if (buildLogPrefix) emitChunk(buildLogPrefix);
              }
            } else {
              return {
                success: false,
                output:
                  'Configure a remote Build or Deploy SSH host for this service so `docker build` runs on that machine. The Weehawk API host does not run Docker.',
              };
            }
            if (registryPush?.trim()) {
              if (!useRemoteDockerBuild || buildRemoteServerId == null) {
                return {
                  success: false,
                  output:
                    'Registry push requires a remote Docker build host. Configure a Build or Deploy SSH server, then deploy again.',
                };
              }
              emitChunk(`Pushing image "${registryPush}" on remote host…\n`);
              const pushAuth =
                await this.registryService.getRegistryAuthConfigForImageRef(
                  registryPush,
                  projectUserId,
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
                    projectOrganizationId,
                  );
                if (pushResult.output) {
                  const pushChunk = pushResult.output + '\n';
                  buildLogPrefix = (buildLogPrefix || '') + pushChunk;
                  emitChunk(pushChunk);
                }
              } catch (pushErr) {
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
            }
          }
          if (
            mode !== 'reload' &&
            deployMode !== 'image' &&
            !sourceRootExists
          ) {
            const sshIds = await this.servicesService.getDockerSshTargetIds(
              service.id,
            );
            const remoteDeployId = sshIds.remoteServerId;
            if (remoteDeployId == null) {
              return {
                success: false,
                output:
                  'No deploy host is set for this service. Open Remote Docker host, select a deploy server, save, then deploy again.',
              };
            }
            const persist = `${WEEHAWK_REMOTE_DEPLOYMENTS_BASE}/${toSafePathSegment(service.appName || 'service')}`;
            const remoteSourceRoot = `${persist}/${sourceDir.replace(/\\/g, '/')}`;
            const remoteBuildPath = buildPath.replace(/\\/g, '/');
            const remoteContext =
              remoteBuildPath === '.'
                ? remoteSourceRoot
                : `${remoteSourceRoot}/${remoteBuildPath}`;
            const dockerfilePosix = dockerfilePath.replace(/\\/g, '/');
            const deployHostLabel = remoteHostPublicLabel(
              service,
              remoteDeployId,
            );

            const {
              isRemoteGit,
              cloneUrl,
              ref,
              gitProviderLabel,
              githubBashAuth,
            } = await this.resolveApplicationRemoteGitCloneParams(
              service,
              rawConfig,
            );

            if (isRemoteGit && cloneUrl) {
              emitChunk(
                `Cloning ${gitProviderLabel ?? 'git'} repository on deploy host ${deployHostLabel} (branch: ${ref})…\n`,
              );
              const remoteCloneScript = this.remoteGitCloneScriptBody(
                shQ,
                remoteSourceRoot,
                ref,
                cloneUrl,
                githubBashAuth,
              );
              await this.remoteServersService.execDockerCliOnRemoteViaSsh(
                remoteDeployId,
                null,
                remoteCloneScript,
                deployLogEmitter ? emitChunk : undefined,
              );
            }

            emitChunk(
              `Local app-source is absent on API host; building on deploy host ${deployHostLabel} from remote tree (${remoteContext})…\n`,
            );
            const nixNodeMajorDeploy = isNixpacksBuild
              ? resolveNixpacksNodeMajorForRemoteBuild(rawConfig)
              : null;
            const nixNodeExportDeploy = nixNodeMajorDeploy
              ? `export NIXPACKS_NODE_VERSION=${shQ(nixNodeMajorDeploy)}\n`
              : '';
            const remoteBuildScript = isNixpacksBuild
              ? `set -euo pipefail
SRC=${shQ(remoteSourceRoot)}
CTX=${shQ(remoteContext)}
if [ ! -d "$SRC" ]; then
  echo "Application source directory \\"${sourceDir}\\" was not found on deploy host (clone or path): $SRC"
  exit 21
fi
if [ ! -d "$CTX" ]; then
  echo "Build path \\"${buildPath}\\" not found under source on deploy host: $CTX"
  exit 22
fi
export PATH="$PATH:$HOME/.local/bin:/root/.local/bin:/usr/local/bin"
${nixNodeExportDeploy}if ! command -v nixpacks >/dev/null 2>&1; then
  echo "nixpacks: command not found. Re-run Weehawk Install on this host (includes Nixpacks CLI)." >&2
  exit 127
fi
cd "$CTX"
${NIXPACKS_ENSURE_DOT_NIXPACKS_IN_DOCKER_CONTEXT}
rm -rf .nixpacks
nixpacks build . --name ${shQ(imageTag)} --env ${shQ(`NIXPACKS_NODE_VERSION=${nixNodeMajorDeploy}`)} ${NIXPACKS_BUILD_CLI_TAIL}
`
              : `set -euo pipefail
SRC=${shQ(remoteSourceRoot)}
CTX=${shQ(remoteContext)}
DF=${shQ(dockerfilePosix)}
if [ ! -d "$SRC" ]; then
  echo "Application source directory \\"${sourceDir}\\" was not found on deploy host (clone or path): $SRC"
  exit 21
fi
if [ ! -d "$CTX" ]; then
  echo "Build path \\"${buildPath}\\" not found under source on deploy host: $CTX"
  exit 22
fi
cd "$CTX"
if [ -f "$DF" ]; then
  docker build -f "$DF" -t ${shQ(imageTag)} .
elif [ -f "$SRC/$DF" ]; then
  echo "Using Dockerfile at repo root ($SRC/$DF) with build context $CTX"
  docker build -f "$SRC/$DF" -t ${shQ(imageTag)} .
else
  echo "Dockerfile not found at $CTX/$DF or $SRC/$DF"
  echo "--- ls $SRC (top) ---"; ls -la "$SRC" 2>&1 | head -40
  echo "--- ls $CTX (build context) ---"; ls -la "$CTX" 2>&1 | head -40
  exit 23
fi
`;
            let rb: { stdout: string; stderr: string };
            try {
              rb = await this.remoteServersService.execDockerCliOnRemoteViaSsh(
                remoteDeployId,
                null,
                remoteBuildScript,
                deployLogEmitter ? emitChunk : undefined,
              );
            } catch (e) {
              const msg = e instanceof Error ? e.message : String(e);
              if (!/exit 21\b/i.test(msg)) {
                throw e;
              }
              emitChunk(
                'Remote application source path is missing; re-syncing compose bundle to deploy host and retrying remote build once…\n',
              );
              await this.syncRemoteDeploymentMirror(id, 0);
              rb = await this.remoteServersService.execDockerCliOnRemoteViaSsh(
                remoteDeployId,
                null,
                remoteBuildScript,
                deployLogEmitter ? emitChunk : undefined,
              );
            }
            buildLogPrefix = [rb.stdout, rb.stderr]
              .filter((s) => s?.trim())
              .join('\n');
            if (buildLogPrefix) {
              emitChunk(`${buildLogPrefix}\n`);
            }
            if (registryPush?.trim()) {
              emitChunk(`Pushing image "${registryPush}" on deploy host…\n`);
              const pushAuth =
                await this.registryService.getRegistryAuthConfigForImageRef(
                  registryPush,
                  projectUserId,
                );
              const pushResult =
                await this.remoteServersService.pushImageUsingDockerodeSsh(
                  remoteDeployId,
                  {
                    imageRef: registryPush,
                    auth: pushAuth,
                  },
                  null,
                  projectOrganizationId,
                );
              if (pushResult.output) {
                const pushChunk = pushResult.output + '\n';
                buildLogPrefix = (buildLogPrefix || '') + pushChunk;
                emitChunk(pushChunk);
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
            projectUserId,
          );
          stackDeployEnv = merged.env;
          stackRegistryCleanup = merged.cleanup;
        }
        const remoteDeployId = sshTargets.remoteServerId;
        if (remoteDeployId != null) {
          const deployHostLabel = remoteHostPublicLabel(
            service,
            remoteDeployId,
          );
          let localDockerConfigDir: string | undefined;
          const dockerCfg = stackDeployEnv.DOCKER_CONFIG;
          if (typeof dockerCfg === 'string' && dockerCfg.trim().length > 0) {
            localDockerConfigDir = dockerCfg.trim();
          }
          try {
            emitChunk(
              `Deploying stack "${service.appName}" on remote host ${deployHostLabel}…\n`,
            );
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
            let out = [buildLogPrefix, r.stdout, r.stderr]
              .filter((s) => s && s.trim())
              .join('\n');
            let err = [buildLogPrefix, r.stderr]
              .filter((s) => s && String(s).trim())
              .join('\n');

            if (mode === 'redeploy') {
              emitChunk('Force-updating services for rolling restart…\n');
              const forced =
                await this.remoteServersService.forceRollingRestartStackViaSsh(
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

        throw new InternalServerErrorException(
          'Swarm deploy requires a deploy host; this should have been validated earlier.',
        );
      }

      const remoteComposeId = sshTargets.remoteServerId;
      const deployEnvCompose = parseEnv(service.env || '');
      if (mode === 'redeploy') {
        try {
          await this.remoteServersService.composeInPersistentDeploymentViaSsh(
            remoteComposeId,
            projectUserId,
            {
              projectName: service.appName,
              composeArgvTail: ['stop'],
              deployEnv: deployEnvCompose,
              onChunk: deployLogEmitter ? emitChunk : undefined,
            },
          );
        } catch {
          /* already stopped or nothing to stop */
        }
      }
      const composeTail =
        mode === 'deploy' || mode === 'redeploy'
          ? (['up', '-d', '--build'] as const)
          : (['up', '-d', '--no-build'] as const);
      const cr =
        await this.remoteServersService.composeInPersistentDeploymentViaSsh(
          remoteComposeId,
          projectUserId,
          {
            projectName: service.appName,
            composeArgvTail: [...composeTail],
            deployEnv: deployEnvCompose,
            onChunk: deployLogEmitter ? emitChunk : undefined,
          },
        );
      const out = [cr.stdout, cr.stderr]
        .filter((s) => s && s.trim())
        .join('\n');
      const err = cr.stderr ?? '';
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
    } catch (error) {
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
    } finally {
      await removeDeploymentFolder(deployDir);
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
    const service = await this.servicesService.internalFindOneById(id);
    const sshTargets = await this.servicesService.getDockerSshTargetIds(
      service.id,
    );
    const projectUserId: number | null = service.project?.userId ?? null;
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
    const deployDir = getServiceDeploymentDir(service.appName, service.id);
    const finalConfig = this.composeYamlForResolvedDeploy(service);
    if (!finalConfig.trim()) {
      throw new BadRequestException(
        'Compose content is empty after resolving ${APP_NAME}. Fix the service YAML and save.',
      );
    }

    try {
      if (!isSwarmStackService(service)) {
        await this.remoteServersService.mirrorDockerComposeToRemotePersistent(
          remoteId,
          projectUserId,
          {
            composeYaml: finalConfig,
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
          projectUserId,
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
      return { ok: true };
    } finally {
      await removeDeploymentFolder(deployDir);
    }
  }

  /** Start stopped containers; compose tries `start` then `up -d --no-build`. Stack: stack deploy. */
  async startContainers(id: number) {
    const service = await this.servicesService.internalFindOneById(id);
    const sshIds = await this.servicesService.getDockerSshTargetIds(service.id);

    if (isSwarmStackService(service)) {
      return await this.execute(id, 'reload');
    }

    if (sshIds.remoteServerId == null) {
      throw new BadRequestException(
        'No deploy host is set for this service. Choose a remote Deploy server under Remote Docker host, save, then start again.',
      );
    }

    const finalConfig = this.composeYamlForResolvedDeploy(service);
    const projectUserId: number | null = service.project?.userId ?? null;
    await this.remoteServersService.mirrorDockerComposeToRemotePersistent(
      sshIds.remoteServerId,
      projectUserId,
      { composeYaml: finalConfig, projectName: service.appName || 'service' },
    );
    const deployEnv = parseEnv(service.env || '');
    try {
      const r =
        await this.remoteServersService.composeInPersistentDeploymentViaSsh(
          sshIds.remoteServerId,
          projectUserId,
          {
            projectName: service.appName,
            composeArgvTail: ['start'],
            deployEnv,
          },
        );
      return {
        success: true,
        output: [r.stdout, r.stderr].filter((s) => s?.trim()).join('\n'),
      };
    } catch {
      const r =
        await this.remoteServersService.composeInPersistentDeploymentViaSsh(
          sshIds.remoteServerId,
          projectUserId,
          {
            projectName: service.appName,
            composeArgvTail: ['up', '-d', '--no-build'],
            deployEnv,
          },
        );
      return {
        success: true,
        output: [r.stdout, r.stderr].filter((s) => s?.trim()).join('\n'),
      };
    }
  }

  async getRuntimeStatus(id: number): Promise<{ running: boolean }> {
    const service = await this.servicesService.internalFindOneById(id);
    const sshIds = await this.servicesService.getDockerSshTargetIds(service.id);
    const projectUserId: number | null = service.project?.userId ?? null;

    try {
      if (isSwarmStackService(service)) {
        let stdout: string;
        if (sshIds.remoteServerId != null) {
          const stackQ = service.appName.replace(/'/g, `'\\''`);
          try {
            const r = await this.withRuntimeTimeout(
              this.remoteServersService.execDockerCliOnRemoteViaSsh(
                sshIds.remoteServerId,
                projectUserId,
                [
                  `n=$(docker stack ps '${stackQ}' --filter desired-state=running -q 2>/dev/null | wc -l)`,
                  `n=$(printf '%s' "$n" | tr -cd '0-9')`,
                  `if [ "\${n:-0}" -gt 0 ] 2>/dev/null; then echo RUNNING; exit 0; fi`,
                  `docker stack services '${stackQ}' --format "{{.Replicas}}" 2>/dev/null || true`,
                ].join('\n'),
              ),
            );
            stdout = r.stdout;
          } catch {
            return { running: false };
          }
        } else {
          return { running: false };
        }
        if (/^RUNNING$/m.test(stdout.trim())) {
          return { running: true };
        }
        const running = stdout.split(/\r?\n/).some((line) => {
          const m = line.trim().match(/^(\d+)\//);
          return m !== null && parseInt(m[1], 10) > 0;
        });
        return { running };
      }

      if (sshIds.remoteServerId == null) {
        return { running: false };
      }

      const deployEnv = parseEnv(service.env || '');
      const r = await this.withRuntimeTimeout(
        this.remoteServersService.composeInPersistentDeploymentViaSsh(
          sshIds.remoteServerId,
          projectUserId,
          {
            projectName: service.appName,
            composeArgvTail: ['ps', '--status', 'running', '-q'],
            deployEnv,
          },
        ),
      );
      return { running: r.stdout.trim().length > 0 };
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
      service = await this.servicesService.internalFindOneById(id);
    } catch (e) {
      if (e instanceof NotFoundException) {
        return { error: 'Service not found.' };
      }
      throw e;
    }

    const sshIds = await this.servicesService.getDockerSshTargetIds(service.id);
    const projectUserId: number | null = service.project?.userId ?? null;
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
          const stackName = service.appName;
          const swarmSvcLabel = `${stackName}_${key}`
            .replace(/\\/g, '\\\\')
            .replace(/"/g, '\\"');
          const nameFilter = swarmSvcLabel;
          try {
            const rLabel =
              await this.remoteServersService.execDockerCliOnRemoteViaSsh(
                sshIds.remoteServerId,
                projectUserId,
                `docker ps -q -f "label=com.docker.swarm.service.name=${swarmSvcLabel}" -f "status=running" 2>/dev/null || true`,
              );
            stdout = rLabel.stdout;
            if (!stdout.trim()) {
              const rName =
                await this.remoteServersService.execDockerCliOnRemoteViaSsh(
                  sshIds.remoteServerId,
                  projectUserId,
                  `docker ps -q -f "name=${nameFilter}" -f "status=running" 2>/dev/null || true`,
                );
              stdout = rName.stdout;
            }
            if (
              !stdout.trim() &&
              service.composeType === composeType.DATABASES
            ) {
              const nsLabel = stackName
                .replace(/\\/g, '\\\\')
                .replace(/"/g, '\\"');
              const rNs =
                await this.remoteServersService.execDockerCliOnRemoteViaSsh(
                  sshIds.remoteServerId,
                  projectUserId,
                  `docker ps -q -f "label=com.docker.stack.namespace=${nsLabel}" -f "status=running" 2>/dev/null || true`,
                );
              stdout = rNs.stdout;
            }
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            return { error: msg || 'Could not resolve container.' };
          }
        } else {
          return { error: SWARM_NEEDS_DEPLOY_HOST_MESSAGE };
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

      if (sshIds.remoteServerId == null) {
        return { error: COMPOSE_NEEDS_DEPLOY_HOST_MESSAGE };
      }

      const deployEnv = parseEnv(service.env || '');
      const pr =
        await this.remoteServersService.composeInPersistentDeploymentViaSsh(
          sshIds.remoteServerId,
          projectUserId,
          {
            projectName: service.appName,
            composeArgvTail: ['ps', '-q', '--status', 'running', key],
            deployEnv,
          },
        );
      const cid = pr.stdout.trim().split(/\r?\n/).filter(Boolean)[0];
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
    const service = await this.servicesService.internalFindOneById(id);
    const sshIds = await this.servicesService.getDockerSshTargetIds(service.id);
    const projectUserId: number | null = service.project?.userId ?? null;
    const deployDir = getServiceDeploymentDir(service.appName, service.id);

    try {
      if (isSwarmStackService(service)) {
        if (sshIds.remoteServerId != null) {
          await this.remoteServersService.stackRmViaSsh(
            sshIds.remoteServerId,
            projectUserId,
            service.appName,
          );
          console.log(`Stack ${service.appName} removed from Swarm.`);
        } else {
          console.warn(
            `stopAndRemove: Swarm service "${service.appName}" has no deploy host; skipped stack removal.`,
          );
        }
      } else if (sshIds.remoteServerId != null) {
        const deployEnv = parseEnv(service.env || '');
        await this.remoteServersService.composeInPersistentDeploymentViaSsh(
          sshIds.remoteServerId,
          projectUserId,
          {
            projectName: service.appName,
            composeArgvTail: ['down', '-v'],
            deployEnv,
          },
        );
        console.log(
          `Compose project ${service.appName} stopped and volumes removed on deploy host.`,
        );
      }
    } catch (error) {
      console.error(`Clean stop failed: ${error.message}`);
    } finally {
      await removeDeploymentFolder(deployDir);
    }
  }

  /**
   * Declared volume/bind mounts from the service compose file (`docker compose config --format json`).
   */
  async getServiceVolumeMounts(id: number): Promise<ServiceVolumesResponseDto> {
    const service = await this.servicesService.internalFindOneById(id);
    const raw = (service.dockerConfig || '').trim();
    if (!raw) {
      return { items: [], error: 'No compose configuration on this service.' };
    }

    const finalConfig = this.composeYamlForResolvedDeploy(service);
    const sshIds = await this.servicesService.getDockerSshTargetIds(service.id);
    const projectUserId: number | null = service.project?.userId ?? null;
    if (sshIds.remoteServerId == null) {
      return {
        items: [],
        error: COMPOSE_NEEDS_DEPLOY_HOST_MESSAGE,
      };
    }

    try {
      await this.remoteServersService.mirrorDockerComposeToRemotePersistent(
        sshIds.remoteServerId,
        projectUserId,
        { composeYaml: finalConfig, projectName: service.appName || 'service' },
      );
      const deployEnv = parseEnv(service.env || '');
      const { stdout } =
        await this.remoteServersService.composeInPersistentDeploymentViaSsh(
          sshIds.remoteServerId,
          projectUserId,
          {
            projectName: service.appName,
            composeArgvTail: ['config', '--format', 'json'],
            deployEnv,
          },
        );
      const cfg = JSON.parse(stdout) as Record<string, unknown>;
      const items = flattenVolumesFromComposeJson(cfg);
      return { items };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return {
        items: [],
        error: `Could not parse compose volumes on the deploy host (is Docker available and the YAML valid?): ${msg}`,
      };
    }
  }

  /**
   * Backup a named Docker volume to `destDir` as a .tar.gz (host path must be absolute).
   */
  async backupDatabaseStructured(
    serviceId: number,
    config: DatabaseBackupConfig,
  ): Promise<{
    success: boolean;
    output: string;
    archiveBasename?: string;
    remoteArtifact?: {
      remoteServerId: number;
      projectUserId: number | null;
      stagingDir: string;
      remoteFilePath: string;
    };
  }> {
    const service = await this.servicesService.internalFindOneById(serviceId);

    const resolved = await this.getExecContainerId(
      serviceId,
      config.composeService,
    );
    if ('error' in resolved) {
      return { success: false, output: resolved.error };
    }

    const sshIds = await this.servicesService.getDockerSshTargetIds(serviceId);
    if (sshIds.remoteServerId == null) {
      return { success: false, output: COMPOSE_NEEDS_DEPLOY_HOST_MESSAGE };
    }
    const projectUserId: number | null = service.project?.userId ?? null;
    const stagingDir =
      await this.remoteServersService.allocRemoteWeehawkTempDir(
        sshIds.remoteServerId,
        projectUserId,
        'weehawk-db-bk',
      );
    const r = await runStructuredDatabaseBackupOnRemoteHost(
      config,
      stagingDir,
      service.appName,
      resolved.id,
      (body) =>
        this.remoteServersService.execDockerCliOnRemoteViaSsh(
          sshIds.remoteServerId!,
          projectUserId,
          body,
        ),
    );
    if (!r.success || !r.archiveBasename) {
      await this.remoteServersService.removeRemoteTreeBestEffort(
        sshIds.remoteServerId,
        projectUserId,
        stagingDir,
      );
      return r;
    }
    return {
      ...r,
      remoteArtifact: {
        remoteServerId: sshIds.remoteServerId,
        projectUserId,
        stagingDir,
        remoteFilePath: `${stagingDir}/${r.archiveBasename}`,
      },
    };
  }

  async backupDockerVolume(
    volumeName: string,
    remoteServerId: number,
    projectUserId: number | null = null,
  ): Promise<{
    success: boolean;
    output: string;
    archiveBasename?: string;
    remoteArtifact?: {
      remoteServerId: number;
      projectUserId: number | null;
      stagingDir: string;
      remoteFilePath: string;
    };
  }> {
    try {
      const safe = volumeName.trim();
      const archiveBasename = `vol-${safe}-${Date.now()}.tar.gz`;
      const { stagingDir, remoteArchivePath } =
        await this.remoteServersService.dockerNamedVolumeBackupArchiveOnRemoteToPath(
          remoteServerId,
          projectUserId,
          volumeName,
          archiveBasename,
        );
      return {
        success: true,
        output: `Archive on deploy host: ${remoteArchivePath}`,
        archiveBasename,
        remoteArtifact: {
          remoteServerId,
          projectUserId,
          stagingDir,
          remoteFilePath: remoteArchivePath,
        },
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { success: false, output: msg };
    }
  }

  /** Restore DB from an uploaded archive (sql / custom / mongodump, etc.). */
  async importDatabaseStructured(
    serviceId: number,
    config: DatabaseBackupConfig,
    hostArchivePath: string,
    opts?: { archiveOnRemoteHost?: boolean },
  ): Promise<{ success: boolean; output: string }> {
    const service = await this.servicesService.internalFindOneById(serviceId);

    const resolved = await this.getExecContainerId(
      serviceId,
      config.composeService,
    );
    if ('error' in resolved) {
      return { success: false, output: resolved.error };
    }
    const sshIds = await this.servicesService.getDockerSshTargetIds(serviceId);
    if (sshIds.remoteServerId == null) {
      return { success: false, output: COMPOSE_NEEDS_DEPLOY_HOST_MESSAGE };
    }
    const projectUserId: number | null = service.project?.userId ?? null;
    const cid = resolved.id;
    const onRemote = Boolean(opts?.archiveOnRemoteHost);
    const docker: StructuredDbImportDocker = {
      copyHostArchiveIntoContainer: (hostPath, destSpec) => {
        const idx = destSpec.indexOf(':');
        const pathInContainer = idx >= 0 ? destSpec.slice(idx + 1) : destSpec;
        if (onRemote) {
          return this.remoteServersService.dockerCpRemoteHostFileToContainer(
            sshIds.remoteServerId!,
            projectUserId,
            hostPath,
            cid,
            pathInContainer,
          );
        }
        return this.remoteServersService.uploadHostFileAndDockerCpToContainer(
          sshIds.remoteServerId!,
          projectUserId,
          hostPath,
          cid,
          pathInContainer,
        );
      },
      execInContainer: async (innerSh) => {
        // execDockerCliOnRemoteViaSsh wraps with `set -eu`. A `docker exec … sh -c "…"` string would be
        // double-quote-expanded on the **deploy host**, so $POSTGRES_PASSWORD* (meant for the container)
        // triggers nounset failures there. Feed the script via stdin + quoted heredoc — no host expansion.
        const marker = `WEEHAWK_DB_IMPORT_${Date.now()}_${randomBytes(6).toString('hex')}`;
        const remoteBody = `docker exec -i ${JSON.stringify(
          cid,
        )} sh -s <<'${marker}'
${innerSh}
${marker}
`;
        const r = await this.remoteServersService.execDockerCliOnRemoteViaSsh(
          sshIds.remoteServerId!,
          projectUserId,
          remoteBody,
        );
        return { stdout: r.stdout, stderr: r.stderr };
      },
      removeInContainer: async (containerPath) => {
        await this.remoteServersService.execDockerCliOnRemoteViaSsh(
          sshIds.remoteServerId!,
          projectUserId,
          `docker exec ${JSON.stringify(cid)} rm -f ${JSON.stringify(containerPath)}`,
        );
      },
    };
    return runStructuredDatabaseImport(config, hostArchivePath, docker, cid, {
      skipLocalFsAccessCheck: onRemote,
    });
  }

  /** Restore a named volume from a .tar.gz produced by volume backup. */
  async importDockerVolume(
    volumeName: string,
    hostArchivePath: string,
    remoteServerId: number,
    projectUserId: number | null = null,
  ): Promise<{ success: boolean; output: string }> {
    try {
      const buf = await fs.readFile(hostArchivePath);
      const base = path.basename(hostArchivePath);
      const r =
        await this.remoteServersService.dockerNamedVolumeImportArchiveOnRemote(
          remoteServerId,
          projectUserId,
          volumeName,
          buf,
          base,
        );
      const out = [r.stdout, r.stderr].filter((s) => s?.trim()).join('\n');
      return {
        success: true,
        output: (out || 'Volume import finished.').slice(0, 8000),
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { success: false, output: msg };
    }
  }

  /**
   * Run a docker command that prints a SQL/text dump on stdout; gzip and write on the deploy host (no API disk).
   * Use plain `pg_dump` text output (not `-Fc`). Command rules match `runWebhookDockerCommand`.
   */
  async backupDatabaseFromDockerCommand(
    serviceId: number,
    rawInput: string,
    _destDir: string,
  ): Promise<{
    success: boolean;
    output: string;
    archiveBasename?: string;
    remoteArtifact?: {
      remoteServerId: number;
      projectUserId: number | null;
      stagingDir: string;
      remoteFilePath: string;
    };
  }> {
    const service = await this.servicesService.internalFindOneById(serviceId);
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
    const sshIds = await this.servicesService.getDockerSshTargetIds(serviceId);
    if (sshIds.remoteServerId == null) {
      return { success: false, output: COMPOSE_NEEDS_DEPLOY_HOST_MESSAGE };
    }
    const projectUserId: number | null = service.project?.userId ?? null;
    const persist = `${WEEHAWK_REMOTE_DEPLOYMENTS_BASE}/${toSafePathSegment(service.appName || 'service')}`;
    const persistQ = persist.replace(/'/g, `'\\''`);
    const stagingDir =
      await this.remoteServersService.allocRemoteWeehawkTempDir(
        sshIds.remoteServerId,
        projectUserId,
        'weehawk-dbcmd',
      );
    const archiveBasename = `db-${service.appName}-${Date.now()}.sql.gz`;
    const outFile = `${stagingDir}/${archiveBasename}`;
    const outQ = `'${outFile.replace(/'/g, `'\\''`)}'`;
    const body = `set -euo pipefail
cd '${persistQ}'
OUT=${outQ}
${cmd} | gzip -c > "$OUT"
test -s "$OUT"
`;
    try {
      const r = await this.remoteServersService.execDockerCliOnRemoteViaSsh(
        sshIds.remoteServerId,
        projectUserId,
        body,
      );
      const stderr = r.stderr ?? '';
      const failed = stderrIndicatesDockerFailure(stderr);
      if (failed) {
        await this.remoteServersService.removeRemoteTreeBestEffort(
          sshIds.remoteServerId,
          projectUserId,
          stagingDir,
        );
        const out = [r.stdout, stderr]
          .filter((s) => s && String(s).trim())
          .join('\n');
        return { success: false, output: out || '(no output)' };
      }
      const out = [r.stdout, stderr]
        .filter((s) => s && String(s).trim())
        .join('\n');
      return {
        success: true,
        output: [out, `Archive: ${outFile}`].filter(Boolean).join('\n'),
        archiveBasename,
        remoteArtifact: {
          remoteServerId: sshIds.remoteServerId,
          projectUserId,
          stagingDir,
          remoteFilePath: outFile,
        },
      };
    } catch (e) {
      await this.remoteServersService.removeRemoteTreeBestEffort(
        sshIds.remoteServerId,
        projectUserId,
        stagingDir,
      );
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
    const service = await this.servicesService.internalFindOneById(serviceId);
    const script = rawInput.trim();
    if (!script) {
      return { success: false, output: 'Script is empty.' };
    }
    const sshIds = await this.servicesService.getDockerSshTargetIds(serviceId);
    if (sshIds.remoteServerId == null) {
      return { success: false, output: COMPOSE_NEEDS_DEPLOY_HOST_MESSAGE };
    }
    const projectUserId: number | null = service.project?.userId ?? null;
    const persist = `${WEEHAWK_REMOTE_DEPLOYMENTS_BASE}/${toSafePathSegment(service.appName || 'service')}`;
    const persistQ = persist.replace(/'/g, `'\\''`);
    const body = `set -euo pipefail
cd '${persistQ}'
${script}
`;
    try {
      const r = await this.remoteServersService.execDockerCliOnRemoteViaSsh(
        sshIds.remoteServerId,
        projectUserId,
        body,
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

  async runSystemScript(
    rawInput: string,
    remoteServerId?: number | null,
    projectUserId?: number | null,
  ): Promise<{ success: boolean; output: string }> {
    const script = rawInput.trim();
    if (!script) {
      return { success: false, output: 'Script is empty.' };
    }
    if (remoteServerId == null) {
      return {
        success: false,
        output:
          'A remote server id is required. Scripts run on the deploy/build host over SSH, not on the Weehawk API machine.',
      };
    }
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

  async shutdown(id: number) {
    const service = await this.servicesService.internalFindOneById(id);
    const sshIds = await this.servicesService.getDockerSshTargetIds(service.id);
    const projectUserId: number | null = service.project?.userId ?? null;

    try {
      if (isSwarmStackService(service)) {
        if (sshIds.remoteServerId == null) {
          throw new BadRequestException(SWARM_NEEDS_DEPLOY_HOST_MESSAGE);
        }
        await this.remoteServersService.scaleAllStackServicesToZeroViaSsh(
          sshIds.remoteServerId,
          projectUserId,
          service.appName,
        );
        return {
          success: true,
          message: 'Stack services scaled to 0 (Stopped)',
        };
      }
      if (sshIds.remoteServerId == null) {
        throw new BadRequestException(COMPOSE_NEEDS_DEPLOY_HOST_MESSAGE);
      }
      const deployEnv = parseEnv(service.env || '');
      await this.remoteServersService.composeInPersistentDeploymentViaSsh(
        sshIds.remoteServerId,
        projectUserId,
        {
          projectName: service.appName,
          composeArgvTail: ['stop'],
          deployEnv,
        },
      );
      return { success: true, message: 'Containers stopped' };
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      this.logger.error(
        'Shutdown failed.',
        error instanceof Error ? error.stack : String(error),
      );
      throw new InternalServerErrorException(
        'Shutdown failed',
      );
    }
  }
}
