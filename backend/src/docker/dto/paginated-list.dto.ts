import type {
  ContainerStatus,
  DockerContainerDto,
  DockerImageDto,
  DockerNetworkDto,
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
