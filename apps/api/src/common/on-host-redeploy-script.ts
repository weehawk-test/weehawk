import { remoteEnvFileQuote } from './remote-wrapped-script-install';
import { composeType } from '../services/entities/composeType.enum';
import type { Service } from '../services/entities/service.entity';
import { toSafePathSegment } from '../services/deployment-paths';
import {
  firstImageRefFromComposeYaml,
  parseConfigHeaderValue,
} from '../executor/executor-compose-parse';

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
  return [
    `WEEHAWK_DOCKER_ON_HOST=${remoteEnvFileQuote('1')}`,
    `WEEHAWK_BUILD_CONTEXT_REL=${remoteEnvFileQuote(buildCtxRel)}`,
    `WEEHAWK_DOCKERFILE_REL=${remoteEnvFileQuote(dockerfilePath)}`,
    `WEEHAWK_IMAGE_TAG=${remoteEnvFileQuote(imageTag)}`,
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
COMPOSE_FILE=""
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
COMPOSE_FILE=""
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
    if [ -f "\$CTX/\$DF_REL" ]; then
      echo "--- docker build on deploy host ---"
      docker build -f "\$CTX/\$DF_REL" -t "\$IMG_TAG" "\$CTX" 2>&1
    else
      echo "WARN: No Dockerfile at \$CTX/\$DF_REL — skipping build (sync app-source from Weehawk)." >&2
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
export function onHostWebhookBundleEnvLines(service: Service): string[] {
  const seg = toSafePathSegment((service.appName ?? '').trim() || 'service');
  const name = (service.appName ?? '').trim() || 'service';
  return [
    `WEEHAWK_DEPLOY_BUNDLE_ROOT=${remoteEnvFileQuote(ON_HOST_DEPLOY_BUNDLE_ROOT)}`,
    `WEEHAWK_BUNDLE_SEGMENT=${remoteEnvFileQuote(seg)}`,
    `WEEHAWK_STACK_PROJECT_NAME=${remoteEnvFileQuote(name)}`,
    ...dockerBuildEnvLinesForApplicationSwarm(service),
  ];
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
