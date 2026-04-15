/** Hint under error banners on Docker console pages */
export const DOCKER_API_HELP =
  "Check that the deploy server is reachable and you are signed in. Manage SSH hosts under Remote servers.";

export type ContainerStatus = "running" | "stopped" | "exited";
export type ServiceStatus = "running" | "stopped" | "degraded";

export interface DockerContainer {
  id: string;
  name: string;
  image: string;
  status: ContainerStatus;
  ports: string;
  createdAt: string;
}

export interface DockerService {
  id: string;
  name: string;
  mode: string;
  replicas: string;
  image: string;
  ports: string;
  status: ServiceStatus;
}

export interface DockerImage {
  id: string;
  repository: string;
  tag: string;
  /** Short ID for display (first 12 hex chars). */
  imageId: string;
  /** Full digest from Docker (`sha256:…` when available). Used for force-delete by ID. */
  imageIdFull: string;
  size: string;
  createdAt: string;
}

export interface DockerVolume {
  id: string;
  name: string;
  size: string;
  createdAt: string;
}

/** Row from `docker network ls --no-trunc --format "{{json .}}"` (mapped on the API). */
export interface DockerNetwork {
  id: string;
  networkIdShort: string;
  name: string;
  driver: string;
  scope: string;
  internal: boolean;
  ipv6: boolean;
  createdAt: string;
}

/** Reference string for `docker rmi` (repo:tag, or id for dangling images). */
export function dockerImageDeleteRef(img: DockerImage): string {
  if (img.repository === "<none>" || img.tag === "<none>") {
    const raw = img.imageIdFull || img.imageId;
    return raw.replace(/^sha256:/i, "");
  }
  return `${img.repository}:${img.tag}`;
}

/**
 * Reference for `docker rmi -f` by image digest (full `sha256:…` when available).
 * Matches: `docker rmi -f sha256:8b81dd37ff…`
 */
export function dockerImageForceDeleteRef(img: DockerImage): string {
  const raw = (img.imageIdFull || img.imageId).trim();
  if (!raw || raw === "—") return dockerImageDeleteRef(img);
  if (/^sha256:/i.test(raw)) return raw;
  if (/^[a-f0-9]{64}$/i.test(raw)) return `sha256:${raw}`;
  return raw;
}
