import { remoteEnvFileQuote } from './remote-wrapped-script-install';
import { composeType } from '../services/entities/composeType.enum';
import type { Service } from '../services/entities/service.entity';
import { toSafePathSegment } from '../services/deployment-paths';
import {
  firstImageRefFromComposeYaml,
  parseConfigHeaderValue,
  parseContainerPortFromComposeYaml,
} from '../executor/executor-compose-parse';
import { buildEnsureDockerfileBashFragment } from './on-host-ensure-dockerfile-bash-fragment';

/** Must match {@link WEEHAWK_REMOTE_DEPLOYMENTS_BASE} in `remote-servers.service.ts`. */
export const ON_HOST_DEPLOY_BUNDLE_ROOT = '/opt/weehawk-deployments';

/** Bash-safe single-quoted string (matches web `service-remote-host-panel.tsx`). */
function shSingleQuote(s: string): string {
  return `'${s.replace(/'/g, `'\"'\"'`)}'`;
}

/**
 * Extra `.env` lines so the deploy host can run `docker build` using mirrored `app-source/`
 * (uploaded when you Save / Deploy / sync mirror from the Weehawk API). No callback to the API.
 */
function dockerBuildEnvLinesForApplicationSwarm(service: Service): string[] {
  if (service.composeType !== composeType.APPLICATION) {
    return [];
  }
  const raw = service.dockerConfig || '';
  const deployMode = parseConfigHeaderValue(raw, 'deployMode')?.toLowerCase() || 'source';
  if (deployMode === 'image') {
    return [];
  }
  const sourceDir = parseConfigHeaderValue(raw, 'sourceDir') || 'app-source';
  const buildPath = parseConfigHeaderValue(raw, 'buildPath') || '.';
  const dockerfilePath = parseConfigHeaderValue(raw, 'dockerfilePath') || 'Dockerfile';
  const bp = buildPath.replace(/^\.\//, '').trim() || '.';
  const buildCtxRel =
    bp === '.' || bp === ''
      ? sourceDir.replace(/\\/g, '/')
      : `${sourceDir.replace(/\\/g, '/')}/${bp}`.replace(/\/+/g, '/');
  const resolvedYaml = raw.replace(/\${APP_NAME}/g, service.appName);
  const imageTag =
    parseConfigHeaderValue(raw, 'registry.pushImage')?.trim() ||
    firstImageRefFromComposeYaml(resolvedYaml) ||
    `${(service.appName ?? '').trim() || 'app'}:latest`;
  const containerPort =
    parseContainerPortFromComposeYaml(raw) ?? 3000;
  return [
    `WEEHAWK_DOCKER_ON_HOST=${remoteEnvFileQuote('1')}`,
    `WEEHAWK_BUILD_CONTEXT_REL=${remoteEnvFileQuote(buildCtxRel)}`,
    `WEEHAWK_DOCKERFILE_REL=${remoteEnvFileQuote(dockerfilePath)}`,
    `WEEHAWK_IMAGE_TAG=${remoteEnvFileQuote(imageTag)}`,
    `WEEHAWK_APP_CONTAINER_PORT=${remoteEnvFileQuote(String(containerPort))}`,
  ];
}

/**
 * Bash run only on the deploy host (Go webhook agent). Does not call the Weehawk API.
 * - Compose: `docker compose up -d --build`
 * - Swarm: optional `docker build` from mirrored context, then `docker stack deploy` + rolling restart.
 */
export function buildOnHostRedeployScriptBody(service: Service): string {
  const appNameRaw = (service.appName ?? '').trim() || 'service';
  const dirSeg = toSafePathSegment(appNameRaw);
  const segFallback = shSingleQuote(dirSeg);
  const nameFallback = shSingleQuote(appNameRaw);
  const rootDefault = ON_HOST_DEPLOY_BUNDLE_ROOT;
  const ensureDockerfileBash = buildEnsureDockerfileBashFragment();

  const autoDeployGitClone = `# Auto-deploy: clone latest code from Git before building.
AD_URL="\${WEEHAWK_AUTO_DEPLOY_CLONE_URL:-}"
AD_BRANCH="\${WEEHAWK_AUTO_DEPLOY_BRANCH:-main}"
if [ -n "\$AD_URL" ]; then
  # GitHub credential helper: generate a fresh installation token from the App PEM key.
  _GH_APP="\${WEEHAWK_GH_APP_ID:-}"
  _GH_INST="\${WEEHAWK_GH_INSTALL_ID:-}"
  _GH_PEM="\${WEEHAWK_GH_PEM_B64:-}"
  if [ -n "\$_GH_APP" ] && [ -n "\$_GH_INST" ] && [ -n "\$_GH_PEM" ]; then
    echo "=== Auto-deploy: generating GitHub installation token ==="
    _KF=\$(mktemp)
    printf '%s' "\$_GH_PEM" | base64 -d > "\$_KF" 2>/dev/null
    _NOW=\$(date +%s)
    _HDR=\$(printf '{"alg":"RS256","typ":"JWT"}' | openssl base64 -e | tr -d '=\\n' | tr '/+' '_-')
    _PLD=\$(printf '{"iat":%d,"exp":%d,"iss":"%s"}' \$((_NOW-60)) \$((_NOW+300)) "\$_GH_APP" | openssl base64 -e | tr -d '=\\n' | tr '/+' '_-')
    _SIG=\$(printf '%s' "\$_HDR.\$_PLD" | openssl dgst -sha256 -sign "\$_KF" | openssl base64 -e | tr -d '=\\n' | tr '/+' '_-')
    _JWT="\$_HDR.\$_PLD.\$_SIG"
    rm -f "\$_KF"
    _TR=\$(curl -sS -X POST \\
      -H "Authorization: Bearer \$_JWT" \\
      -H "Accept: application/vnd.github+json" \\
      "https://api.github.com/app/installations/\$_GH_INST/access_tokens" 2>&1)
    _GH_TOK=\$(printf '%s' "\$_TR" | sed -n 's/.*"token"[[:space:]]*:[[:space:]]*"\\([^"]*\\)".*/\\1/p' | head -1)
    if [ -n "\$_GH_TOK" ]; then
      AD_URL=\$(printf '%s' "\$AD_URL" | sed "s|https://|https://x-access-token:\${_GH_TOK}@|")
      echo "=== Auto-deploy: GitHub token OK ==="
    else
      echo "WARN: Could not get GitHub token. Clone may fail for private repos." >&2
      echo "Response: \$_TR" >&2
    fi
  fi
  echo "=== Auto-deploy: fetching source (branch: \$AD_BRANCH) ==="
  AD_SRC_REL="\${WEEHAWK_BUILD_CONTEXT_REL:-app-source}"
  AD_TARGET="\$ROOT/\$AD_SRC_REL"
  rm -rf "\$AD_TARGET"
  mkdir -p "\$(dirname "\$AD_TARGET")"
  if command -v git >/dev/null 2>&1; then
    git clone --depth 1 --branch "\$AD_BRANCH" "\$AD_URL" "\$AD_TARGET" 2>&1 || {
      echo "Auto-deploy git clone failed." >&2
      exit 1
    }
  else
    echo "(git not found — downloading tarball via curl)"
    _GL_ID="\${WEEHAWK_GITLAB_PROJECT_ID:-}"
    _GL_BASE="\${WEEHAWK_GITLAB_API_BASE:-}"
    _GL_TOK="\${WEEHAWK_GITLAB_PRIVATE_TOKEN:-}"
    if [ -n "\$_GL_ID" ] && [ -n "\$_GL_BASE" ] && [ -n "\$_GL_TOK" ]; then
      echo "=== Auto-deploy: GitLab API archive (project \$_GL_ID) ==="
      _GL_BT="\${_GL_BASE%/}"
      _GL_ROOT="\${_GL_BT}/api/v4/projects/\${_GL_ID}/repository/archive.tar.gz"
      mkdir -p "\$AD_TARGET"
      curl -fsSL -G "\$_GL_ROOT" --data-urlencode "sha=\${AD_BRANCH}" \\
        -H "PRIVATE-TOKEN: \${_GL_TOK}" | tar xz --strip-components=1 -C "\$AD_TARGET" 2>&1 || {
        echo "Auto-deploy GitLab API archive failed (project \$_GL_ID)." >&2
        exit 1
      }
    else
      _TAR_BASE=\$(printf '%s' "\$AD_URL" | sed 's/\\.git\$//')
      _SLUG=\$(printf '%s' "\$_TAR_BASE" | awk -F/ '{print \$NF}')
      case "\$_TAR_BASE" in
        *github.com/*)
          _TAR_DL="\${_TAR_BASE}/archive/refs/heads/\${AD_BRANCH}.tar.gz"
          ;;
        *)
          _TAR_DL="\${_TAR_BASE}/-/archive/\${AD_BRANCH}/\${_SLUG}-\${AD_BRANCH}.tar.gz"
          ;;
      esac
      mkdir -p "\$AD_TARGET"
      curl -fsSL "\$_TAR_DL" | tar xz --strip-components=1 -C "\$AD_TARGET" 2>&1 || {
        echo "Auto-deploy tarball download failed (\$_TAR_DL)." >&2
        exit 1
      }
    fi
  fi
  weehawk_ensure_generated_dockerfile_in_context "\$AD_TARGET" "\${WEEHAWK_DOCKERFILE_REL:-Dockerfile}" || exit 1
  echo "=== Auto-deploy: source ready ==="
fi
`;

  if (service.composeType === composeType.COMPOSE) {
    return `set -euo pipefail
${ensureDockerfileBash}
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
${ensureDockerfileBash}
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
  if [ -n "\$IMG_TAG" ] && [ -d "\$CTX" ]; then
    weehawk_ensure_generated_dockerfile_in_context "\$CTX" "\$DF_REL" || exit 1
    if [ -f "\$CTX/\$DF_REL" ]; then
      echo "--- docker build on deploy host ---"
      docker build -f "\$CTX/\$DF_REL" -t "\$IMG_TAG" "\$CTX" 2>&1
    else
      echo "WARN: No Dockerfile at \$CTX/\$DF_REL — skipping build." >&2
    fi
  else
    echo "WARN: Build context missing or WEEHAWK_IMAGE_TAG empty — skipping docker build." >&2
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
    if (autoDeploy.githubAppId && autoDeploy.githubInstallationId && autoDeploy.githubPrivateKeyPem) {
      const pemB64 = Buffer.from(autoDeploy.githubPrivateKeyPem).toString('base64');
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
export function looksLikeGeneratedOnHostRedeployScript(dockerCommand: string | null | undefined): boolean {
  const t = (dockerCommand ?? '').trim();
  if (!t) return false;
  return (
    (t.includes(ON_HOST_DEPLOY_BUNDLE_ROOT) || t.includes('WEEHAWK_BUNDLE_SEGMENT')) &&
    (t.includes('COMPOSE_FILE') ||
      t.includes('Bundle directory missing') ||
      t.includes('No readable compose file') ||
      t.includes('This folder is empty') ||
      t.includes('WEEHAWK_DOCKER_ON_HOST') ||
      t.includes('on-host'))
  );
}
