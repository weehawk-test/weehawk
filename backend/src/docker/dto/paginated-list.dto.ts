import type {
  ContainerStatus,
  DockerContainerDto,
  DockerImageDto,
  DockerNetworkDto,
  DockerServiceDto,
  DockerVolumeDto,
} from '../docker-row.mapper';

export interface ContainerCountsDto {
  running: number;
  stopped: number;
  exited: number;
  all: number;
}

export interface PaginatedContainersDto {
  items: DockerContainerDto[];
  total: number;
  totalAll: number;
  page: number;
  pageSize: number;
  counts: ContainerCountsDto;
}

export interface PaginatedImagesDto {
  items: DockerImageDto[];
  total: number;
  totalAll: number;
  page: number;
  pageSize: number;
}

export interface PaginatedVolumesDto {
  items: DockerVolumeDto[];
  total: number;
  totalAll: number;
  page: number;
  pageSize: number;
}

export interface PaginatedNetworksDto {
  items: DockerNetworkDto[];
  total: number;
  totalAll: number;
  page: number;
  pageSize: number;
}

export interface ServiceCountsDto {
  running: number;
  stopped: number;
  degraded: number;
  all: number;
}

export interface PaginatedServicesDto {
  items: DockerServiceDto[];
  total: number;
  totalAll: number;
  page: number;
  pageSize: number;
  counts: ServiceCountsDto;
}

export function countByStatus(
  items: Array<{ status: ContainerStatus }>,
): ContainerCountsDto {
  let running = 0;
  let stopped = 0;
  let exited = 0;
  for (const c of items) {
    if (c.status === 'running') running++;
    else if (c.status === 'exited') exited++;
    else stopped++;
  }
  return {
    running,
    stopped,
    exited,
    all: items.length,
  };
}

export function countServicesByStatus(
  items: Array<{ status: 'running' | 'stopped' | 'degraded' }>,
): ServiceCountsDto {
  let running = 0;
  let stopped = 0;
  let degraded = 0;
  for (const s of items) {
    if (s.status === 'running') running++;
    else if (s.status === 'degraded') degraded++;
    else stopped++;
  }
  return { running, stopped, degraded, all: items.length };
}
