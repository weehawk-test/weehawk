import { WEEHAWK_TRAEFIK_EXTERNAL_NETWORK } from '../traefik/traefik.constants';

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
 * Aligns with Weehawk app stacks: Docker Engine, Swarm, overlay {@link WEEHAWK_TRAEFIK_EXTERNAL_NETWORK}.
 */
export function buildWeehawkProvisionScript(opts: {
  role: 'deploy' | 'build';
  /** Overlay name for Traefik + app attachment (default weehawk). */
  overlayNetworkName?: string;
}): string {
  const net = (opts.overlayNetworkName ?? WEEHAWK_TRAEFIK_EXTERNAL_NETWORK).trim() || 'weehawk';
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

$SUDO_CMD systemctl enable docker 2>/dev/null || true
$SUDO_CMD systemctl start docker 2>/dev/null || true

if [ -n "$SUDO_CMD" ] && ! groups "$CURRENT_USER" | grep -qw docker; then
  $SUDO_CMD usermod -aG docker "$CURRENT_USER" || true
fi

echo "Docker OK ($(docker --version 2>/dev/null || echo '?'))"
echo "Weehawk build host provision: done."
`.trim();
  }

  return `
set -e
OS_TYPE=$(grep -w "ID" /etc/os-release | cut -d "=" -f 2 | tr -d '"')
SYS_ARCH=$(uname -m)
CURRENT_USER=$USER
OVERLAY_NET="${net}"

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

if [ -n "$SUDO_CMD" ] && ! groups "$CURRENT_USER" | grep -qw docker; then
  $SUDO_CMD usermod -aG docker "$CURRENT_USER" || true
fi

echo "Docker OK ($(docker --version 2>/dev/null || echo '?'))"
echo "Weehawk deploy host provision: done."
`.trim();
}
