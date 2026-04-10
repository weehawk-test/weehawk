import { remoteEnvFileQuote } from './remote-wrapped-script-install';
import { composeType } from '../services/entities/composeType.enum';
import type { Service } from '../services/entities/service.entity';
import { toSafePathSegment } from '../services/deployment-paths';

/** Must match {@link WEEHAWK_REMOTE_DEPLOYMENTS_BASE} in `remote-servers.service.ts`. */
export const ON_HOST_DEPLOY_BUNDLE_ROOT = '/opt/weehawk-deployments';

/** Bash-safe single-quoted string (matches web `service-remote-host-panel.tsx`). */
function shSingleQuote(s: string): string {
  return `'${s.replace(/'/g, `'\"'\"'`)}'`;
}

/**
 * Bash run on the deploy host. Prefer `WEEHAWK_*` vars from the webhook `.env` (set on every script
 * install) so the directory always matches the API mirror even if the script body was stale.
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
# Do not mkdir here — an empty dir was masking "mirror never uploaded". Only Weehawk deploy/sync should create this tree.
if [ ! -d "\$ROOT" ]; then
  echo "Bundle directory missing: \$ROOT. Deploy this service from Weehawk to this remote host, or POST .../sync-remote-deployment-mirror (then Regenerate redeploy webhook)." >&2
  exit 1
fi
cd "\$ROOT"
COMPOSE_FILE=""
for cand in docker-compose.yml compose.yaml docker-compose.yaml; do
  if [ -f "\$cand" ] && [ -r "\$cand" ]; then COMPOSE_FILE=\$cand; break; fi
done
if [ -z "\$COMPOSE_FILE" ]; then
  echo "No docker-compose.yml / compose.yaml under \$ROOT (pwd=\$(pwd)). Listing:" >&2
  ls -la >&2
  echo "This folder is empty or has no compose file: Weehawk has not mirrored files here yet, or you are on a different machine than the deploy host. Deploy from Weehawk to this server or run sync-remote-deployment-mirror." >&2
  exit 1
fi
_WH_LOG=\$(mktemp 2>/dev/null || echo "/tmp/weehawk-redeploy.\$\$.log")
trap 'rm -f "\$_WH_LOG"' EXIT
docker compose -f "\$COMPOSE_FILE" -p "\$PROJ" stop >/dev/null 2>&1 || true
if ! docker compose -f "\$COMPOSE_FILE" -p "\$PROJ" up -d --build >"\$_WH_LOG" 2>&1; then cat "\$_WH_LOG" >&2; exit 1; fi
echo "Weehawk redeploy: OK (compose project \$PROJ)."
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
  echo "Bundle directory missing: \$ROOT. Deploy this service from Weehawk to this remote host, or POST .../sync-remote-deployment-mirror (then Regenerate redeploy webhook)." >&2
  exit 1
fi
cd "\$ROOT"
COMPOSE_FILE=""
for cand in docker-compose.yml compose.yaml docker-compose.yaml; do
  if [ -f "\$cand" ] && [ -r "\$cand" ]; then COMPOSE_FILE=\$cand; break; fi
done
if [ -z "\$COMPOSE_FILE" ]; then
  echo "No docker-compose.yml / compose.yaml under \$ROOT (pwd=\$(pwd)). Listing:" >&2
  ls -la >&2
  echo "This folder is empty or has no compose file: Weehawk has not mirrored files here yet, or you are on a different machine than the deploy host. Deploy from Weehawk to this server or run sync-remote-deployment-mirror." >&2
  exit 1
fi
[ -f weehawk-stack-env.sh ] && . ./weehawk-stack-env.sh
if [ -d docker-config ] && [ -f docker-config/config.json ]; then
  export DOCKER_CONFIG="\$(pwd)/docker-config"
fi
_WH_LOG=\$(mktemp 2>/dev/null || echo "/tmp/weehawk-redeploy.\$\$.log")
trap 'rm -f "\$_WH_LOG"' EXIT
if ! docker stack deploy -c "\$COMPOSE_FILE" --with-registry-auth "\$PROJ" >"\$_WH_LOG" 2>&1; then cat "\$_WH_LOG" >&2; exit 1; fi
SERVICES=\$(docker stack services "\$PROJ" --format "{{.Name}}" 2>/dev/null || true)
for svc in \$SERVICES; do
  [ -n "\$svc" ] && docker service update --force "\$svc" >/dev/null 2>&1 || true
done
echo "Weehawk redeploy: OK (stack \$PROJ)."
`;
}

/** Lines appended to the remote webhook `.env` so the script resolves the mirror path from the API. */
export function onHostWebhookBundleEnvLines(service: Service): string[] {
  const seg = toSafePathSegment((service.appName ?? '').trim() || 'service');
  const name = (service.appName ?? '').trim() || 'service';
  return [
    `WEEHAWK_DEPLOY_BUNDLE_ROOT=${remoteEnvFileQuote(ON_HOST_DEPLOY_BUNDLE_ROOT)}`,
    `WEEHAWK_BUNDLE_SEGMENT=${remoteEnvFileQuote(seg)}`,
    `WEEHAWK_STACK_PROJECT_NAME=${remoteEnvFileQuote(name)}`,
  ];
}

/** True for scripts generated from the Weehawk on-host redeploy template (safe to overwrite after deploy). */
export function looksLikeGeneratedOnHostRedeployScript(dockerCommand: string | null | undefined): boolean {
  const t = (dockerCommand ?? '').trim();
  if (!t) return false;
  return (
    (t.includes(ON_HOST_DEPLOY_BUNDLE_ROOT) || t.includes('WEEHAWK_BUNDLE_SEGMENT')) &&
    (t.includes('test -f docker-compose.yml') ||
      t.includes('COMPOSE_FILE') ||
      t.includes('No readable compose file') ||
      t.includes('Bundle directory missing') ||
      t.includes('This folder is empty'))
  );
}
