import { WEEHAWK_TRAEFIK_EXTERNAL_NETWORK } from '../traefik/traefik.constants';
import { WEEHAWK_BUNDLED_WEBHOOK_AGENT_IMAGE } from './weehawk-webhook-agent.constants';

function bashSingleQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/**
 * How the deploy host gets the weehawk-webhook-agent Docker image during Install.
 * - registry: docker pull (then tag as {@link WEEHAWK_BUNDLED_WEBHOOK_AGENT_IMAGE} if needed)
 * - bundle: docker build from base64 files embedded by the API job
 * - none: skip (first webhook with public host may still build remotely)
 */
export type WebhookAgentProvisionInput =
  | { mode: 'none' }
  | { mode: 'registry'; image: string }
  | {
      mode: 'bundle';
      imageTag: string;
      dockerfileB64: string;
      mainGoB64: string;
      goModB64: string;
    };

/**
 * Shared bash: install Docker without pinning versions (avoids apt downgrade errors).
 * On Debian/Ubuntu uses apt with --allow-downgrades; elsewhere get.docker.com with VERSION vars unset.
 * Note: get.docker.com currently defaults to searching VERSION 28.5.0 internally — apt path avoids that.
 */
const BASH_DOCKER_INSTALL_FN = `
docker_install_weehawk() {
  if command -v apt-get >/dev/null 2>&1 && [ -r /etc/os-release ]; then
    . /etc/os-release
    case "$ID" in
      ubuntu|debian|raspbian)
        export DEBIAN_FRONTEND=noninteractive
        $SUDO_CMD apt-get update -y
        $SUDO_CMD apt-get install -y ca-certificates curl
        $SUDO_CMD install -m 0755 -d /etc/apt/keyrings
        $SUDO_CMD curl -fsSL "https://download.docker.com/linux/\${ID}/gpg" -o /etc/apt/keyrings/docker.asc
        $SUDO_CMD chmod a+r /etc/apt/keyrings/docker.asc
        $SUDO_CMD sh -c "echo \\"deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/\${ID} \${VERSION_CODENAME} stable\\" > /etc/apt/sources.list.d/docker.list"
        $SUDO_CMD apt-get update -y
        $SUDO_CMD apt-get install -y --allow-downgrades \\
          docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin \\
          docker-ce-rootless-extras docker-model-plugin \\
          || $SUDO_CMD apt-get install -y --allow-downgrades \\
          docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
        return 0
        ;;
    esac
  fi
  unset DOCKER_VERSION VERSION 2>/dev/null || true
  curl -fsSL https://get.docker.com | $SUDO_CMD sh
}
`.trim();

/** Install Git on common Linux distros (needed for clone/fetch auto-deploy flow). */
const BASH_GIT_INSTALL_FN = `
git_install_weehawk() {
  if command -v git >/dev/null 2>&1; then
    return 0
  fi
  if command -v apt-get >/dev/null 2>&1; then
    export DEBIAN_FRONTEND=noninteractive
    $SUDO_CMD apt-get update -y
    $SUDO_CMD apt-get install -y git
    return 0
  fi
  if command -v dnf >/dev/null 2>&1; then
    $SUDO_CMD dnf install -y git
    return 0
  fi
  if command -v yum >/dev/null 2>&1; then
    $SUDO_CMD yum install -y git
    return 0
  fi
  if command -v apk >/dev/null 2>&1; then
    $SUDO_CMD apk add --no-cache git
    return 0
  fi
  echo "Could not install git automatically. Please install git and re-run."
  return 1
}
`.trim();

/** Install Nixpacks CLI (https://nixpacks.com/docs/install) for Dockerfile-less builds on the host. */
const BASH_NIXPACKS_INSTALL_FN = `
# Default Node major for manual \`nixpacks build\` in SSH sessions (matches Weehawk API). Override: export NIXPACKS_NODE_VERSION=22
weehawk_write_nixpacks_profile_defaults() {
  if [ "$(id -u)" -ne 0 ] || [ ! -d /etc/profile.d ]; then
    return 0
  fi
  f=/etc/profile.d/weehawk-nixpacks-defaults.sh
  cat > "$f" <<'WEEHAWK_NIXPACKS_PROFILE'
# Managed by Weehawk — default Node for Nixpacks (Next.js 16+). Override per shell: export NIXPACKS_NODE_VERSION=18
export NIXPACKS_NODE_VERSION="\${NIXPACKS_NODE_VERSION:-20}"
WEEHAWK_NIXPACKS_PROFILE
  chmod 644 "$f" 2>/dev/null || true
}

nixpacks_install_weehawk() {
  weehawk_write_nixpacks_profile_defaults
  if command -v nixpacks >/dev/null 2>&1; then
    echo "Nixpacks already installed ($(nixpacks --version 2>/dev/null || echo ok))"
    return 0
  fi
  if ! command -v curl >/dev/null 2>&1; then
    echo "WARN: curl not found — skipping Nixpacks install. Install curl and re-run, or install Nixpacks manually." >&2
    return 0
  fi
  echo "Installing Nixpacks CLI (for optional Nixpacks builds)..."
  export NIXPACKS_INSTALL_NONINTERACTIVE=1
  if curl -fsSL https://nixpacks.com/install.sh | bash; then
    export PATH="$PATH:$HOME/.local/bin:/root/.local/bin:/usr/local/bin"
    if command -v nixpacks >/dev/null 2>&1; then
      echo "Nixpacks installed ($(nixpacks --version 2>/dev/null || echo ok))"
    else
      echo "WARN: Nixpacks install finished but \`nixpacks\` not on PATH — add ~/.local/bin or re-login." >&2
    fi
  else
    echo "WARN: Nixpacks install script failed — install manually: https://nixpacks.com/docs/install" >&2
  fi
}
`.trim();

/**
 * Minimal remote bash: only defines and runs `nixpacks_install_weehawk` (same helper as full provision).
 * Use when the host is already set up and the user only wants the Nixpacks CLI.
 */
export function buildNixpacksOnlyInstallScript(): string {
  return `
set -e
echo "Weehawk: Nixpacks CLI only — no Docker/Swarm/Traefik changes."
export PATH="$PATH:$HOME/.local/bin:/root/.local/bin:/usr/local/bin"

${BASH_NIXPACKS_INSTALL_FN}

nixpacks_install_weehawk || true
echo "Weehawk: Nixpacks step finished."
`.trim();
}

/** YAML scalar for ACME email (JSON-quoted; empty when unset). */
function traefikYamlEmailScalar(email: string): string {
  return JSON.stringify(email.trim());
}

/**
 * Static Traefik config on the deploy host: `/opt/weehawk/traefik/data/traefik.yml`.
 * Keep entrypoint names `web` / `websecure` in sync with RemoteServersService Swarm labels.
 */
export function buildTraefikStaticYaml(opts: {
  acmeEmail: string;
  dockerNetwork: string;
}): string {
  const email = traefikYamlEmailScalar(opts.acmeEmail);
  const { dockerNetwork } = opts;
  return [
    '## Weehawk — generated by remote-server-provision.script',
    'api:',
    '  dashboard: false',
    '',
    'ping: true',
    '',
    'log:',
    '  level: INFO',
    '',
    'entryPoints:',
    '  web:',
    '    address: ":80"',
    '    http:',
    '      redirections:',
    '        entryPoint:',
    '          to: websecure',
    '          scheme: https',
    '  websecure:',
    '    address: ":443"',
    '    http:',
    '      tls: {}',
    '',
    'certificatesResolvers:',
    '  letsencrypt:',
    '    acme:',
    `      email: ${email}`,
    '      storage: /acme.json',
    '      httpChallenge:',
    '        entryPoint: web',
    '',
    'providers:',
    '  providersThrottleDuration: 2s',
    '  docker:',
    '    watch: true',
    '    exposedByDefault: false',
    '    swarmMode: true',
    `    network: ${dockerNetwork}`,
    '',
  ].join('\n');
}

/**
 * Swarm stack file: `/opt/weehawk/traefik/traefik-stack.yml` (bind-mounts static config + acme.json).
 */
export function buildTraefikStackYaml(opts: { dockerNetwork: string }): string {
  const { dockerNetwork } = opts;
  return [
    '## Weehawk — generated by remote-server-provision.script',
    'version: "3.8"',
    'services:',
    '  traefik:',
    '    image: traefik:v2.11',
    '    command:',
    '      - "--configFile=/etc/traefik/traefik.yml"',
    '    ports:',
    '      - "80:80"',
    '      - "443:443"',
    '    volumes:',
    '      - /var/run/docker.sock:/var/run/docker.sock:ro',
    '      - /opt/weehawk/traefik/data/acme.json:/acme.json',
    '      - /opt/weehawk/traefik/data/traefik.yml:/etc/traefik/traefik.yml:ro',
    '    networks:',
    `      - ${dockerNetwork}`,
    '    deploy:',
    '      placement:',
    '        constraints:',
    '          - node.role == manager',
    '',
    'networks:',
    `  ${dockerNetwork}:`,
    '    external: true',
    '',
  ].join('\n');
}

function buildDeployWebhookAgentBash(
  wa: WebhookAgentProvisionInput | undefined,
  isPreview: boolean,
): string {
  const tagQ = bashSingleQuote(WEEHAWK_BUNDLED_WEBHOOK_AGENT_IMAGE);

  if (isPreview) {
    return `
# --- Weehawk webhook agent image ---
echo "Weehawk: [script preview only] A real Install job embeds docker pull (if WEEHAWK_WEBHOOK_AGENT_IMAGE is set) or docker build for ${WEEHAWK_BUNDLED_WEBHOOK_AGENT_IMAGE} from the API bundle."
`.trim();
  }

  const input = wa ?? { mode: 'none' as const };

  if (input.mode === 'none') {
    return `
# --- Weehawk webhook agent image ---
echo "Weehawk: webhook agent image not pre-installed (set WEEHAWK_WEBHOOK_AGENT_IMAGE on the API or ship the API bundle). You can still create a webhook; the API may build ${WEEHAWK_BUNDLED_WEBHOOK_AGENT_IMAGE} on first use."
`.trim();
  }

  if (input.mode === 'registry') {
    const pullQ = bashSingleQuote(input.image);
    return `
# --- Weehawk webhook agent image (registry) ---
WA_IMG=${tagQ}
PULL_IMG=${pullQ}
echo "Weehawk: pulling webhook agent from registry..."
$SUDO_CMD docker pull "$PULL_IMG"
if [ "$PULL_IMG" != "$WA_IMG" ]; then
  $SUDO_CMD docker tag "$PULL_IMG" "$WA_IMG"
fi
echo "Weehawk: webhook agent image ready ($WA_IMG)"
`.trim();
  }

  const { dockerfileB64, mainGoB64, goModB64, imageTag } = input;
  const imgQ = bashSingleQuote(imageTag);
  return `
# --- Weehawk webhook agent image (docker build from API bundle) ---
WA_IMG=${imgQ}
WA_DIR=$(mktemp -d)
wa_cleanup() { rm -rf "$WA_DIR"; }
trap wa_cleanup EXIT
printf '%s' '${dockerfileB64}' | base64 -d > "$WA_DIR/Dockerfile"
printf '%s' '${mainGoB64}' | base64 -d > "$WA_DIR/main.go"
printf '%s' '${goModB64}' | base64 -d > "$WA_DIR/go.mod"
echo "Weehawk: building webhook agent ($WA_IMG)..."
$SUDO_CMD docker build -t "$WA_IMG" "$WA_DIR"
wa_cleanup
trap - EXIT
echo "Weehawk: webhook agent image ready ($WA_IMG)"
`.trim();
}

/**
 * Start {@code weehawk-webhook-agent} as a Swarm service so `docker service ls` shows it right after Install.
 * Uses host-published TCP (default 8759) until a webhook with a public hostname triggers Traefik labels (API recreates the service).
 */
function buildDeployWebhookSwarmServiceBash(isPreview: boolean): string {
  const img = WEEHAWK_BUNDLED_WEBHOOK_AGENT_IMAGE;
  if (isPreview) {
    return `
# --- weehawk-webhook-agent Swarm service ---
echo "Weehawk: [script preview] Install also creates Swarm service weehawk-webhook-agent (host :8759) when image ${img} exists."
`.trim();
  }

  return `
# --- weehawk-webhook-agent Swarm service (visible in docker service ls) ---
WA_SVC='weehawk-webhook-agent'
WA_PORT='8759'
WA_SCRIPTS='/opt/weehawk-scripts/webhooks'
WA_DEPLOY='/opt/weehawk-deployments'
WA_PFIX='hooks'
WA_IMG='${img}'
WA_MOUNT="type=bind,source=\${WA_SCRIPTS},target=\${WA_SCRIPTS}"
WA_MOUNT_DEPLOY="type=bind,source=\${WA_DEPLOY},target=\${WA_DEPLOY}"
WA_MOUNT_SOCK="type=bind,source=/var/run/docker.sock,target=/var/run/docker.sock"
$SUDO_CMD mkdir -p "$WA_SCRIPTS"
$SUDO_CMD mkdir -p "$WA_DEPLOY"
if ! $SUDO_CMD docker image inspect "$WA_IMG" >/dev/null 2>&1; then
  echo "Weehawk: skip $WA_SVC — Docker image not present (set WEEHAWK_WEBHOOK_AGENT_IMAGE on the API or ship the webhook bundle)."
elif $SUDO_CMD docker service ls --format '{{.Name}}' 2>/dev/null | grep -qx "$WA_SVC"; then
  echo "Weehawk: Swarm service $WA_SVC already exists."
else
  echo "Weehawk: creating Swarm service $WA_SVC (health: curl -sS http://127.0.0.1:\${WA_PORT}/\${WA_PFIX}/healthz)..."
  $SUDO_CMD docker service create \\
    --name "$WA_SVC" \\
    --network "$OVERLAY_NET" \\
    --constraint node.role==manager \\
    --mount "$WA_MOUNT" \\
    --mount "$WA_MOUNT_DEPLOY" \\
    --mount "$WA_MOUNT_SOCK" \\
    -e "WEEHAWK_HOOK_LISTEN=:\${WA_PORT}" \\
    -e "WEEHAWK_HOOK_SCRIPTS_DIR=$WA_SCRIPTS" \\
    -e "WEEHAWK_HOOK_PATH_PREFIX=$WA_PFIX" \\
    --publish mode=host,published="\${WA_PORT}",target="\${WA_PORT}" \\
    "$WA_IMG"
  echo "Weehawk: $WA_SVC is up. Public URL via Traefik after you add a webhook public hostname; until then use http://<manager-ip>:\${WA_PORT}/weehawk-hooks/<token>."
fi
`.trim();
}

/**
 * Full Docker removal for Debian/Ubuntu when old or conflicting packages block a clean install.
 * Destructive: stops containers, purges packages, deletes /var/lib/docker and related data.
 */
export function buildDockerPurgeScript(): string {
  return `
set -e

echo "Starting full Docker removal and cleanup (Debian/Ubuntu apt-based hosts only)."

if [ "$EUID" -eq 0 ]; then
  SUDO_CMD=""
else
  if sudo -n true 2>/dev/null; then
    SUDO_CMD="sudo"
  else
    echo "Error: need root or passwordless sudo."
    exit 1
  fi
fi

if ! command -v apt-get >/dev/null 2>&1; then
  echo "This script requires apt-get (Debian/Ubuntu). Aborting."
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive

echo "Stopping containers and Docker services..."
if command -v docker >/dev/null 2>&1 && $SUDO_CMD docker info >/dev/null 2>&1; then
  IDS=$($SUDO_CMD docker ps -aq 2>/dev/null || true)
  if [ -n "$IDS" ]; then
    $SUDO_CMD docker stop $IDS 2>/dev/null || true
  fi
fi
$SUDO_CMD systemctl stop docker.service 2>/dev/null || true
$SUDO_CMD systemctl stop docker.socket 2>/dev/null || true

echo "Purging Docker packages..."
$SUDO_CMD apt-get purge -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin docker-ce-rootless-extras docker-model-plugin 2>/dev/null || true

echo "Removing data and configuration (images, containers, and local volumes under /var/lib/docker are deleted)..."
$SUDO_CMD rm -rf /var/lib/docker
$SUDO_CMD rm -rf /var/lib/containerd
$SUDO_CMD rm -rf /etc/docker
$SUDO_CMD rm -rf /run/docker.sock
rm -rf "\${HOME}/.docker" 2>/dev/null || true

echo "Removing docker group if present..."
$SUDO_CMD groupdel docker 2>/dev/null || true

echo "Removing orphan package dependencies..."
$SUDO_CMD apt-get autoremove -y
$SUDO_CMD apt-get autoclean

echo "Docker removal finished. You can run Install again for a fresh Docker Engine."
`.trim();
}

/**
 * Remote bash provision script (run as root or passwordless sudo).
 * Deploy role: Docker, Swarm, overlay, Traefik (`/opt/weehawk/traefik/*.yml` + stack deploy), and webhook agent image (pull or build).
 */
export function buildWeehawkProvisionScript(opts: {
  role: 'deploy' | 'build';
  /** Overlay name for Traefik + app attachment (default weehawk). */
  overlayNetworkName?: string;
  webhookAgent?: WebhookAgentProvisionInput;
  /** GET preview: omit embedded base64 bundle; print placeholders instead. */
  isProvisionJobPreview?: boolean;
  /** Email for ACME (Let's Encrypt) certificates on the deploy Traefik instance. */
  acmeEmail?: string;
}): string {
  const net =
    (opts.overlayNetworkName ?? WEEHAWK_TRAEFIK_EXTERNAL_NETWORK).trim() ||
    'weehawk';
  const isBuild = opts.role === 'build';

  if (isBuild) {
    return `
set -e
OS_TYPE=$(grep -w "ID" /etc/os-release | cut -d "=" -f 2 | tr -d '"')
SYS_ARCH=$(uname -m)
CURRENT_USER=$USER

echo "Weehawk build host provision | OS: $OS_TYPE | arch: $SYS_ARCH"

if [ "$EUID" -eq 0 ]; then
  SUDO_CMD=""
else
  if sudo -n true 2>/dev/null; then
    SUDO_CMD="sudo"
  else
    echo "Error: need root or passwordless sudo."
    exit 1
  fi
fi

command_exists() { command -v "$@" >/dev/null 2>&1; }

${BASH_DOCKER_INSTALL_FN}
${BASH_GIT_INSTALL_FN}

if ! command_exists curl; then
  if command_exists apt-get; then
    export DEBIAN_FRONTEND=noninteractive
    $SUDO_CMD apt-get update -y && $SUDO_CMD apt-get install -y curl
  elif command_exists dnf; then
    $SUDO_CMD dnf install -y curl
  elif command_exists apk; then
    $SUDO_CMD apk add curl
  else
    echo "Install curl, then re-run."
    exit 1
  fi
fi

if command_exists docker && $SUDO_CMD docker info >/dev/null 2>&1; then
  echo "Docker already installed and running."
else
  echo "Installing Docker (apt on Debian/Ubuntu without version pin, or get.docker.com with VERSION unset)..."
  docker_install_weehawk || {
    echo "Docker install failed; see https://docs.docker.com/engine/install/"
    exit 1
  }
fi

if command_exists git; then
  echo "Git already installed."
else
  echo "Installing Git..."
  git_install_weehawk || exit 1
fi

$SUDO_CMD systemctl enable docker 2>/dev/null || true
$SUDO_CMD systemctl start docker 2>/dev/null || true

if [ -n "$SUDO_CMD" ] && ! groups "$CURRENT_USER" | grep -qw docker; then
  $SUDO_CMD usermod -aG docker "$CURRENT_USER" || true
fi

echo "Docker OK ($(docker --version 2>/dev/null || echo '?'))"
echo "Weehawk build host provision: done."
`.trim();
  }

  const webhookBash = buildDeployWebhookAgentBash(
    opts.webhookAgent,
    Boolean(opts.isProvisionJobPreview),
  );
  const webhookSwarmBash = buildDeployWebhookSwarmServiceBash(
    Boolean(opts.isProvisionJobPreview),
  );

  const acmeEmailForYaml = (opts.acmeEmail ?? '').trim();
  const traefikStaticYaml = buildTraefikStaticYaml({
    acmeEmail: acmeEmailForYaml,
    dockerNetwork: net,
  });
  const traefikStackYaml = buildTraefikStackYaml({ dockerNetwork: net });
  const traefikStaticB64 = Buffer.from(traefikStaticYaml, 'utf8').toString(
    'base64',
  );
  const traefikStackB64 = Buffer.from(traefikStackYaml, 'utf8').toString(
    'base64',
  );

  return `
set -e
OS_TYPE=$(grep -w "ID" /etc/os-release | cut -d "=" -f 2 | tr -d '"')
SYS_ARCH=$(uname -m)
CURRENT_USER=$USER
OVERLAY_NET="${net}"
ACME_EMAIL="${(opts.acmeEmail ?? '').replace(/"/g, '\\"')}"

echo "Weehawk deploy host provision | OS: $OS_TYPE | arch: $SYS_ARCH | network: $OVERLAY_NET"

if [ "$EUID" -eq 0 ]; then
  SUDO_CMD=""
else
  if sudo -n true 2>/dev/null; then
    SUDO_CMD="sudo"
  else
    echo "Error: need root or passwordless sudo."
    exit 1
  fi
fi

command_exists() { command -v "$@" >/dev/null 2>&1; }

${BASH_DOCKER_INSTALL_FN}
${BASH_GIT_INSTALL_FN}

if ! command_exists curl; then
  if command_exists apt-get; then
    export DEBIAN_FRONTEND=noninteractive
    $SUDO_CMD apt-get update -y && $SUDO_CMD apt-get install -y curl
  elif command_exists dnf; then
    $SUDO_CMD dnf install -y curl
  elif command_exists apk; then
    $SUDO_CMD apk add curl
  else
    echo "Install curl, then re-run."
    exit 1
  fi
fi

if command_exists docker && $SUDO_CMD docker info >/dev/null 2>&1; then
  echo "Docker already installed and running."
else
  echo "Installing Docker (apt on Debian/Ubuntu without version pin, or get.docker.com with VERSION unset)..."
  docker_install_weehawk || {
    echo "Docker install failed; see https://docs.docker.com/engine/install/"
    exit 1
  }
fi

if command_exists git; then
  echo "Git already installed."
else
  echo "Installing Git..."
  git_install_weehawk || exit 1
fi

$SUDO_CMD systemctl enable docker 2>/dev/null || true
$SUDO_CMD systemctl start docker 2>/dev/null || true

if $SUDO_CMD docker info 2>/dev/null | grep -q 'Swarm: active'; then
  echo "Docker Swarm already active."
else
  get_ip() {
    local ip=""
    ip=$(curl -4s --connect-timeout 5 https://ifconfig.io 2>/dev/null || true)
    if [ -z "$ip" ]; then ip=$(curl -4s --connect-timeout 5 https://icanhazip.com 2>/dev/null || true); fi
    if [ -z "$ip" ]; then ip=$(curl -4s --connect-timeout 5 https://ipecho.net/plain 2>/dev/null || true); fi
    if [ -z "$ip" ]; then
      echo "Could not detect public IP for swarm advertise; set ADVERTISE_ADDR and re-run." >&2
      exit 1
    fi
    echo "$ip"
  }
  AD=$(get_ip)
  echo "Swarm advertise: $AD"
  $SUDO_CMD docker swarm init --advertise-addr "$AD"
  echo "Swarm initialized."
fi

if $SUDO_CMD docker network ls --format '{{.Name}}' | grep -qx "$OVERLAY_NET"; then
  echo "Overlay $OVERLAY_NET exists."
else
  $SUDO_CMD docker network create --driver overlay --attachable "$OVERLAY_NET"
  echo "Overlay $OVERLAY_NET created."
fi

TRAEFIK_DIR="/opt/weehawk/traefik"
ACME_JSON_PATH="$TRAEFIK_DIR/data/acme.json"
$SUDO_CMD mkdir -p /opt/weehawk
$SUDO_CMD mkdir -p "$TRAEFIK_DIR/data"

printf '%s' '${traefikStaticB64}' | base64 -d | $SUDO_CMD tee "$TRAEFIK_DIR/data/traefik.yml" > /dev/null
printf '%s' '${traefikStackB64}' | base64 -d | $SUDO_CMD tee "$TRAEFIK_DIR/traefik-stack.yml" > /dev/null
if [ ! -f "$ACME_JSON_PATH" ]; then
  if [ -f "/opt/weehawk/acme.json" ]; then
    $SUDO_CMD cp -a /opt/weehawk/acme.json "$ACME_JSON_PATH"
  else
    $SUDO_CMD touch "$ACME_JSON_PATH"
  fi
fi
$SUDO_CMD chmod 600 "$ACME_JSON_PATH"
$SUDO_CMD chmod 644 "$TRAEFIK_DIR/data/traefik.yml" "$TRAEFIK_DIR/traefik-stack.yml" 2>/dev/null || true

if $SUDO_CMD docker service ls --format '{{.Name}}' 2>/dev/null | grep -qx "traefik-weehawk"; then
  echo "Removing legacy traefik-weehawk service (replaced by stack traefik-weehawk)..."
  $SUDO_CMD docker service rm traefik-weehawk || true
fi

$SUDO_CMD docker stack deploy -c "$TRAEFIK_DIR/traefik-stack.yml" traefik-weehawk
echo "Traefik stack traefik-weehawk applied (config: $TRAEFIK_DIR)."

${webhookBash}

${webhookSwarmBash}

if [ -n "$SUDO_CMD" ] && ! groups "$CURRENT_USER" | grep -qw docker; then
  $SUDO_CMD usermod -aG docker "$CURRENT_USER" || true
fi

echo "Docker OK ($(docker --version 2>/dev/null || echo '?'))"
echo "Weehawk deploy host provision: done."
`.trim();
}
