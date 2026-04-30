import { remoteEnvFileQuote } from './remote-wrapped-script-install';
import { composeType } from '../services/entities/composeType.enum';
import type { Service } from '../services/entities/service.entity';
import { toSafePathSegment } from '../services/deployment-paths';
import {
  firstImageRefFromComposeYaml,
  parseConfigHeaderValue,
  parseContainerPortFromComposeYaml,
  resolveNixpacksNodeMajorForRemoteBuild,
} from '../executor/executor-compose-parse';
import { bashGithubInstallationTokenMutateUrl } from './github-install-token-bash';
/** Must match {@link WEEHAWK_REMOTE_DEPLOYMENTS_BASE} in `remote-servers.service.ts`. */
export const ON_HOST_DEPLOY_BUNDLE_ROOT = '/opt/weehawk-deployments';

/** Bash-safe single-quoted string (matches web `service-remote-host-panel.tsx`). */
function shSingleQuote(s: string): string {
  return `'${s.replace(/'/g, `'\"'\"'`)}'`;
}

/**
 * Extra `.env` lines so the deploy host can run `docker build` / Nixpacks using `app-source/` under
 * the persistent deploy dir (populated by Git clone on the host, not by uploading source from the API).
 */
function dockerBuildEnvLinesForApplicationSwarm(service: Service): string[] {
  if (service.composeType !== composeType.APPLICATION) {
    return [];
  }
  const raw = service.dockerConfig || '';
  const deployMode =
    parseConfigHeaderValue(raw, 'deployMode')?.toLowerCase() || 'source';
  if (deployMode === 'image') {
    return [];
  }
  const sourceDir = parseConfigHeaderValue(raw, 'sourceDir') || 'app-source';
  const buildPath = parseConfigHeaderValue(raw, 'buildPath') || '.';
  const dockerfilePath =
    parseConfigHeaderValue(raw, 'dockerfilePath') || 'Dockerfile';
  const bp = buildPath.replace(/^\.\//, '').trim() || '.';
  const sourceDirNorm = sourceDir.replace(/\\/g, '/');
  const buildCtxRel =
    bp === '.' || bp === ''
      ? sourceDirNorm
      : `${sourceDirNorm}/${bp}`.replace(/\/+/g, '/');
  const resolvedYaml = raw.replace(/\${APP_NAME}/g, service.appName);
  const imageTag =
    parseConfigHeaderValue(raw, 'registry.pushImage')?.trim() ||
    firstImageRefFromComposeYaml(resolvedYaml) ||
    `${(service.appName ?? '').trim() || 'app'}:latest`;
  const containerPort = parseContainerPortFromComposeYaml(raw) ?? 3000;
  const bm = (
    parseConfigHeaderValue(raw, 'buildMode') || 'dockerfile'
  ).toLowerCase();
  const weehawkBuildMode =
    bm === 'nixpacks' || bm === 'buildpacks' ? 'nixpacks' : 'dockerfile';
  const lines = [
    `WEEHAWK_DOCKER_ON_HOST=${remoteEnvFileQuote('1')}`,
    /** Repo root on the host (git clone target); {@link buildCtxRel} may be a subfolder for `docker build`. */
    `WEEHAWK_SOURCE_DIR_REL=${remoteEnvFileQuote(sourceDirNorm)}`,
    `WEEHAWK_BUILD_CONTEXT_REL=${remoteEnvFileQuote(buildCtxRel)}`,
    `WEEHAWK_DOCKERFILE_REL=${remoteEnvFileQuote(dockerfilePath)}`,
    `WEEHAWK_IMAGE_TAG=${remoteEnvFileQuote(imageTag)}`,
    `WEEHAWK_APP_CONTAINER_PORT=${remoteEnvFileQuote(String(containerPort))}`,
    `WEEHAWK_BUILD_MODE=${remoteEnvFileQuote(weehawkBuildMode)}`,
  ];
  if (weehawkBuildMode === 'nixpacks') {
    lines.push(
      `NIXPACKS_NODE_VERSION=${remoteEnvFileQuote(resolveNixpacksNodeMajorForRemoteBuild(raw))}`,
    );
  }
  return lines;
}

/**
 * Bash run only on the deploy host (Go webhook agent). Does not call the Weehawk API.
 * - Compose: `docker compose up -d --build`
 * - Swarm: optional `docker build` / Nixpacks from on-host source tree, then `docker stack deploy` + rolling restart.
 */
export function buildOnHostRedeployScriptBody(service: Service): string {
  const appNameRaw = (service.appName ?? '').trim() || 'service';
  const dirSeg = toSafePathSegment(appNameRaw);
  const segFallback = shSingleQuote(dirSeg);
  const nameFallback = shSingleQuote(appNameRaw);
  const rootDefault = ON_HOST_DEPLOY_BUNDLE_ROOT;

  const autoDeployGitClone = `# Auto-deploy: clone latest code from Git before building.
AD_URL="\${WEEHAWK_AUTO_DEPLOY_CLONE_URL:-}"
AD_BRANCH="\${WEEHAWK_AUTO_DEPLOY_BRANCH:-main}"
if [ -n "\$AD_URL" ]; then
  # GitHub credential helper: generate a fresh installation token from the App PEM key.
  _GH_APP="\${WEEHAWK_GH_APP_ID:-}"
  _GH_INST="\${WEEHAWK_GH_INSTALL_ID:-}"
  _GH_PEM="\${WEEHAWK_GH_PEM_B64:-}"
${bashGithubInstallationTokenMutateUrl('AD_URL', 'Auto-deploy')}
  echo "=== Auto-deploy: fetching source (branch: \$AD_BRANCH) ==="
  AD_SRC_REL="\${WEEHAWK_SOURCE_DIR_REL:-}"
  if [ -z "\$AD_SRC_REL" ]; then AD_SRC_REL="\${WEEHAWK_BUILD_CONTEXT_REL:-app-source}"; fi
  AD_TARGET="\$ROOT/\$AD_SRC_REL"
  mkdir -p "\$(dirname "\$AD_TARGET")"
  if ! command -v git >/dev/null 2>&1; then
    echo "Auto-deploy requires git on the deploy host (git not found)." >&2
    exit 1
  fi
  if [ -d "\$AD_TARGET/.git" ]; then
    echo "=== Auto-deploy: git fetch/pull ==="
    git -C "\$AD_TARGET" remote set-url origin "\$AD_URL" || true
    git -C "\$AD_TARGET" fetch --depth 1 origin "\$AD_BRANCH" || {
      echo "Auto-deploy git fetch failed." >&2
      exit 1
    }
    git -C "\$AD_TARGET" checkout -B "\$AD_BRANCH" "origin/\$AD_BRANCH" || {
      echo "Auto-deploy git checkout failed." >&2
      exit 1
    }
    git -C "\$AD_TARGET" reset --hard "origin/\$AD_BRANCH" || {
      echo "Auto-deploy git reset failed." >&2
      exit 1
    }
    git -C "\$AD_TARGET" clean -fdx || true
  else
    rm -rf "\$AD_TARGET"
    git clone --depth 1 --branch "\$AD_BRANCH" "\$AD_URL" "\$AD_TARGET" || {
      echo "Auto-deploy git clone failed." >&2
      exit 1
    }
  fi
  echo "=== Auto-deploy: source ready ==="
fi
`;

  if (service.composeType === composeType.COMPOSE) {
    return `set -euo pipefail
BROOT="\${WEEHAWK_DEPLOY_BUNDLE_ROOT:-${rootDefault}}"
BROOT="\$(printf '%s' "\$BROOT" | tr -d '\\r')"
SEG="\${WEEHAWK_BUNDLE_SEGMENT:-}"
SEG="\$(printf '%s' "\$SEG" | tr -d '\\r')"
if [ -z "\$SEG" ]; then SEG=${segFallback}; fi
PROJ="\${WEEHAWK_STACK_PROJECT_NAME:-}"
PROJ="\$(printf '%s' "\$PROJ" | tr -d '\\r')"
if [ -z "\$PROJ" ]; then PROJ=${nameFallback}; fi
ROOT="\$BROOT/\$SEG"
if [ ! -d "\$ROOT" ]; then
  echo "Bundle directory missing: \$ROOT. Sync from Weehawk (Save / sync-remote-deployment-mirror) first." >&2
  exit 1
fi
cd "\$ROOT"
${autoDeployGitClone}COMPOSE_FILE=""
for cand in docker-compose.yml compose.yaml docker-compose.yaml; do
  if [ -f "\$cand" ] && [ -r "\$cand" ]; then COMPOSE_FILE=\$cand; break; fi
done
if [ -z "\$COMPOSE_FILE" ]; then
  echo "No compose file under \$ROOT." >&2
  ls -la >&2
  exit 1
fi
echo "=== Weehawk redeploy: compose \$PROJ (on-host) ==="
docker compose -f "\$COMPOSE_FILE" -p "\$PROJ" stop 2>&1 || true
docker compose -f "\$COMPOSE_FILE" -p "\$PROJ" up -d --build 2>&1
docker compose -f "\$COMPOSE_FILE" -p "\$PROJ" ps 2>&1 || true
echo "=== Weehawk redeploy: OK (compose \$PROJ) ==="
`;
  }

  return `set -euo pipefail
BROOT="\${WEEHAWK_DEPLOY_BUNDLE_ROOT:-${rootDefault}}"
BROOT="\$(printf '%s' "\$BROOT" | tr -d '\\r')"
SEG="\${WEEHAWK_BUNDLE_SEGMENT:-}"
SEG="\$(printf '%s' "\$SEG" | tr -d '\\r')"
if [ -z "\$SEG" ]; then SEG=${segFallback}; fi
PROJ="\${WEEHAWK_STACK_PROJECT_NAME:-}"
PROJ="\$(printf '%s' "\$PROJ" | tr -d '\\r')"
if [ -z "\$PROJ" ]; then PROJ=${nameFallback}; fi
ROOT="\$BROOT/\$SEG"
if [ ! -d "\$ROOT" ]; then
  echo "Bundle directory missing: \$ROOT. Sync from Weehawk first." >&2
  exit 1
fi
cd "\$ROOT"
${autoDeployGitClone}COMPOSE_FILE=""
for cand in docker-compose.yml compose.yaml docker-compose.yaml; do
  if [ -f "\$cand" ] && [ -r "\$cand" ]; then COMPOSE_FILE=\$cand; break; fi
done
if [ -z "\$COMPOSE_FILE" ]; then
  echo "No compose file under \$ROOT." >&2
  exit 1
fi
[ -f weehawk-stack-env.sh ] && . ./weehawk-stack-env.sh
if [ -d docker-config ] && [ -f docker-config/config.json ]; then
  export DOCKER_CONFIG="\$(pwd)/docker-config"
fi
echo "=== Weehawk redeploy: stack \$PROJ (on-host, no API) ==="
if [ "\${WEEHAWK_DOCKER_ON_HOST:-}" = "1" ]; then
  BUILD_CTX_REL="\${WEEHAWK_BUILD_CONTEXT_REL:-app-source}"
  DF_REL="\${WEEHAWK_DOCKERFILE_REL:-Dockerfile}"
  IMG_TAG="\${WEEHAWK_IMAGE_TAG:-}"
  CTX="\$ROOT/\$BUILD_CTX_REL"
  if [ -z "\$IMG_TAG" ]; then
    echo "ERROR: WEEHAWK_IMAGE_TAG is empty — cannot run on-host Dockerfile/Nixpacks build." >&2
    exit 1
  fi
  if [ ! -d "\$CTX" ]; then
    echo "ERROR: Build context directory missing: \$CTX" >&2
    echo "Link a Git repo in Weehawk (service → auto-deploy / repo) so redeploy can clone source, or sync app source to this path on the host." >&2
    exit 1
  fi
  if [ "\${WEEHAWK_BUILD_MODE:-dockerfile}" = "nixpacks" ]; then
    export PATH="\$PATH:\$HOME/.local/bin:/root/.local/bin:/usr/local/bin"
    if ! command -v nixpacks >/dev/null 2>&1; then
      echo "ERROR: nixpacks not found — re-run Weehawk Install on this host or install https://nixpacks.com/docs/install" >&2
      exit 1
    fi
    echo "--- nixpacks build on deploy host ---"
    (
      cd "\$CTX" || exit 1
      weehawk_nixpacks_restore_dockerignore() {
        if [ -f .dockerignore.weehawk-nixpacks-bak ]; then
          mv -f .dockerignore.weehawk-nixpacks-bak .dockerignore
        fi
      }
      trap weehawk_nixpacks_restore_dockerignore EXIT
      if [ -f .dockerignore ]; then
        mv -f .dockerignore .dockerignore.weehawk-nixpacks-bak
      fi
      rm -rf .nixpacks
      _NPV="\${NIXPACKS_NODE_VERSION:-20}"
      nixpacks build . --name "\$IMG_TAG" --env "NIXPACKS_NODE_VERSION=\$_NPV" --no-cache 2>&1
    )
  elif [ -f "\$CTX/\$DF_REL" ]; then
    echo "--- docker build on deploy host (no cache, pull base images) ---"
    docker build --pull --no-cache -f "\$CTX/\$DF_REL" -t "\$IMG_TAG" "\$CTX" 2>&1
  else
    echo "ERROR: No Dockerfile at \$CTX/\$DF_REL — add a Dockerfile or choose Nixpacks build in Weehawk." >&2
    exit 1
  fi
fi
echo "--- docker stack deploy ---"
docker stack deploy -c "\$COMPOSE_FILE" --with-registry-auth "\$PROJ" 2>&1
echo "--- rolling restart ---"
SERVICES=\$(docker stack services "\$PROJ" --format "{{.Name}}" 2>/dev/null || true)
for svc in \$SERVICES; do
  if [ -n "\$svc" ]; then
    echo "Updating: \$svc"
    docker service update --force "\$svc" 2>&1 || true
  fi
done
docker stack services "\$PROJ" 2>&1 || true
echo "=== Weehawk redeploy: OK (stack \$PROJ) ==="
`;
}

/** Lines appended to the remote webhook `.env` (bundle paths + optional on-host docker build). */
export function onHostWebhookBundleEnvLines(
  service: Service,
  autoDeploy?: {
    cloneUrl: string;
    branch: string;
    githubAppId?: string;
    githubInstallationId?: string;
    githubPrivateKeyPem?: string;
    gitlabProjectId?: string;
    gitlabApiBase?: string;
    gitlabPrivateToken?: string;
  } | null,
): string[] {
  const seg = toSafePathSegment((service.appName ?? '').trim() || 'service');
  const name = (service.appName ?? '').trim() || 'service';
  const lines = [
    `WEEHAWK_DEPLOY_BUNDLE_ROOT=${remoteEnvFileQuote(ON_HOST_DEPLOY_BUNDLE_ROOT)}`,
    `WEEHAWK_BUNDLE_SEGMENT=${remoteEnvFileQuote(seg)}`,
    `WEEHAWK_STACK_PROJECT_NAME=${remoteEnvFileQuote(name)}`,
    ...dockerBuildEnvLinesForApplicationSwarm(service),
  ];
  if (autoDeploy?.cloneUrl) {
    lines.push(
      `WEEHAWK_AUTO_DEPLOY_CLONE_URL=${remoteEnvFileQuote(autoDeploy.cloneUrl)}`,
      `WEEHAWK_AUTO_DEPLOY_BRANCH=${remoteEnvFileQuote(autoDeploy.branch || 'main')}`,
    );
    if (
      autoDeploy.githubAppId &&
      autoDeploy.githubInstallationId &&
      autoDeploy.githubPrivateKeyPem
    ) {
      const pemB64 = Buffer.from(autoDeploy.githubPrivateKeyPem).toString(
        'base64',
      );
      lines.push(
        `WEEHAWK_GH_APP_ID=${remoteEnvFileQuote(autoDeploy.githubAppId)}`,
        `WEEHAWK_GH_INSTALL_ID=${remoteEnvFileQuote(autoDeploy.githubInstallationId)}`,
        `WEEHAWK_GH_PEM_B64=${remoteEnvFileQuote(pemB64)}`,
      );
    }
    if (
      autoDeploy.gitlabProjectId &&
      autoDeploy.gitlabApiBase &&
      autoDeploy.gitlabPrivateToken
    ) {
      lines.push(
        `WEEHAWK_GITLAB_PROJECT_ID=${remoteEnvFileQuote(autoDeploy.gitlabProjectId)}`,
        `WEEHAWK_GITLAB_API_BASE=${remoteEnvFileQuote(autoDeploy.gitlabApiBase)}`,
        `WEEHAWK_GITLAB_PRIVATE_TOKEN=${remoteEnvFileQuote(autoDeploy.gitlabPrivateToken)}`,
      );
    }
  }
  return lines;
}

/** True for scripts generated from the Weehawk on-host redeploy template (safe to overwrite after deploy). */
export function looksLikeGeneratedOnHostRedeployScript(
  bashScript: string | null | undefined,
): boolean {
  const t = (bashScript ?? '').trim();
  if (!t) return false;
  return (
    (t.includes(ON_HOST_DEPLOY_BUNDLE_ROOT) ||
      t.includes('WEEHAWK_BUNDLE_SEGMENT')) &&
    (t.includes('COMPOSE_FILE') ||
      t.includes('Bundle directory missing') ||
      t.includes('No readable compose file') ||
      t.includes('This folder is empty') ||
      t.includes('WEEHAWK_DOCKER_ON_HOST') ||
      t.includes('on-host'))
  );
}
