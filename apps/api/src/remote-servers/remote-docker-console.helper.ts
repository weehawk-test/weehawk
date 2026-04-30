import type Dockerode from 'dockerode';
import {
  filterContainers,
  filterImages,
  filterNetworks,
  filterServices,
  filterVolumes,
  mapDockerodeContainerToDto,
  mapDockerImageRow,
  mapDockerNetworkRow,
  mapDockerServiceRow,
  mapDockerVolumeRow,
} from '../docker/docker-row.mapper';
import {
  countByStatus,
  countServicesByStatus,
  type PaginatedContainersDto,
  type PaginatedImagesDto,
  type PaginatedNetworksDto,
  type PaginatedServicesDto,
  type PaginatedVolumesDto,
} from '../docker/dto/paginated-list.dto';

function clampPage(page: number): number {
  return Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
}

function clampPageSize(size: number): number {
  const n = Number.isFinite(size) ? Math.floor(size) : 10;
  return Math.min(Math.max(n, 1), 100);
}

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '—';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v < 10 && i > 0 ? v.toFixed(1) : Math.round(v)} ${u[i]}`;
}

/** Expand Dockerode `listImages` to rows compatible with {@link mapDockerImageRow}. */
export function dockerodeImagesToRawRows(
  images: Dockerode.ImageInfo[],
): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  for (const img of images) {
    const id = img.Id || '';
    const created =
      typeof img.Created === 'number'
        ? new Date(img.Created * 1000).toISOString()
        : new Date().toISOString();
    const size = formatBytes(img.Size ?? 0);
    const tags = img.RepoTags?.filter((t) => t && t.length > 0);
    if (tags && tags.length > 0) {
      for (const rt of tags) {
        const idx = rt.lastIndexOf(':');
        const repo = idx > 0 ? rt.slice(0, idx) : rt;
        const tag = idx > 0 ? rt.slice(idx + 1) : 'latest';
        rows.push({
          ID: id,
          Repository: repo,
          Tag: tag,
          Size: size,
          CreatedAt: created,
        });
      }
    } else {
      rows.push({
        ID: id,
        Repository: '<none>',
        Tag: '<none>',
        Size: size,
        CreatedAt: created,
      });
    }
  }
  return rows;
}

export function dockerodeNetworksToRawRows(
  nets: Dockerode.NetworkInspectInfo[],
): Record<string, unknown>[] {
  return nets.map((n) => ({
    ID: n.Id,
    Name: n.Name,
    Driver: n.Driver ?? '—',
    Scope: n.Scope ?? '—',
    Internal: n.Internal ? 'true' : 'false',
    IPv6: n.EnableIPv6 ? 'true' : 'false',
    CreatedAt: n.Created ?? '',
  }));
}

export function dockerodeVolumesToRawRows(
  vols: Array<{ Name?: string; CreatedAt?: string }> | undefined,
): Record<string, unknown>[] {
  if (!vols?.length) return [];
  return vols.map((v) => ({
    Name: v.Name ?? '—',
    CreatedAt: v.CreatedAt ?? '',
    Size: null,
  }));
}

function serviceToRawRow(
  s: Dockerode.Service,
  index: number,
): Record<string, unknown> {
  const spec = s.Spec;
  const name = spec?.Name ?? `service-${index}`;
  const tt = spec?.TaskTemplate as
    | { ContainerSpec?: { Image?: string } }
    | undefined;
  const image = tt?.ContainerSpec?.Image ?? '—';
  let mode = '—';
  if (spec?.Mode?.Replicated) mode = 'replicated';
  else if (spec?.Mode?.Global) mode = 'global';
  let replicas = '0/0';
  const st = s.ServiceStatus;
  if (st && typeof st.DesiredTasks === 'number') {
    replicas = `${st.RunningTasks ?? 0}/${st.DesiredTasks}`;
  } else if (
    spec?.Mode?.Replicated &&
    typeof spec.Mode.Replicated.Replicas === 'number'
  ) {
    replicas = `0/${spec.Mode.Replicated.Replicas}`;
  }
  return {
    ID: s.ID,
    Name: name,
    Mode: mode,
    Replicas: replicas,
    Image: image,
    Ports: '—',
  };
}

export async function pagedRemoteContainers(
  docker: Dockerode,
  pageRaw: number,
  pageSizeRaw: number,
  search: string,
): Promise<PaginatedContainersDto> {
  const page = clampPage(pageRaw);
  const pageSize = clampPageSize(pageSizeRaw);
  const rows = await docker.listContainers({ all: true });
  const mapped = rows.map((c, i) => mapDockerodeContainerToDto(c, i));
  const filtered = filterContainers(mapped, search ?? '');
  const total = filtered.length;
  const start = (page - 1) * pageSize;
  const items = filtered.slice(start, start + pageSize);
  const counts = countByStatus(mapped);
  return {
    items,
    total,
    totalAll: mapped.length,
    page,
    pageSize,
    counts,
  };
}

export async function pagedRemoteImages(
  docker: Dockerode,
  pageRaw: number,
  pageSizeRaw: number,
  search: string,
): Promise<PaginatedImagesDto> {
  const page = clampPage(pageRaw);
  const pageSize = clampPageSize(pageSizeRaw);
  const imgs = await docker.listImages({ all: false });
  const raw = dockerodeImagesToRawRows(imgs);
  const mapped = raw.map((r, i) => mapDockerImageRow(r, i));
  const filtered = filterImages(mapped, search ?? '');
  const total = filtered.length;
  const start = (page - 1) * pageSize;
  const items = filtered.slice(start, start + pageSize);
  return {
    items,
    total,
    totalAll: mapped.length,
    page,
    pageSize,
  };
}

export async function pagedRemoteNetworks(
  docker: Dockerode,
  pageRaw: number,
  pageSizeRaw: number,
  search: string,
): Promise<PaginatedNetworksDto> {
  const page = clampPage(pageRaw);
  const pageSize = clampPageSize(pageSizeRaw);
  const nets = await docker.listNetworks();
  const raw = dockerodeNetworksToRawRows(nets);
  const mapped = raw.map((r, i) => mapDockerNetworkRow(r, i));
  const filtered = filterNetworks(mapped, search ?? '');
  const total = filtered.length;
  const start = (page - 1) * pageSize;
  const items = filtered.slice(start, start + pageSize);
  return {
    items,
    total,
    totalAll: mapped.length,
    page,
    pageSize,
  };
}

export async function pagedRemoteVolumes(
  docker: Dockerode,
  pageRaw: number,
  pageSizeRaw: number,
  search: string,
): Promise<PaginatedVolumesDto> {
  const page = clampPage(pageRaw);
  const pageSize = clampPageSize(pageSizeRaw);
  const volData = await docker.listVolumes();
  const raw = dockerodeVolumesToRawRows(volData.Volumes);
  const mapped = raw.map((r, i) => mapDockerVolumeRow(r, i));
  const filtered = filterVolumes(mapped, search ?? '');
  const total = filtered.length;
  const start = (page - 1) * pageSize;
  const items = filtered.slice(start, start + pageSize);
  return {
    items,
    total,
    totalAll: mapped.length,
    page,
    pageSize,
  };
}

export async function pagedRemoteServices(
  docker: Dockerode,
  pageRaw: number,
  pageSizeRaw: number,
  search: string,
): Promise<PaginatedServicesDto> {
  const page = clampPage(pageRaw);
  const pageSize = clampPageSize(pageSizeRaw);
  let svcs: Dockerode.Service[] = [];
  try {
    svcs = await docker.listServices();
  } catch {
    svcs = [];
  }
  const raw = svcs.map((s, i) => serviceToRawRow(s, i));
  const mapped = raw.map((r, i) => mapDockerServiceRow(r, i));
  const filtered = filterServices(mapped, search ?? '');
  const total = filtered.length;
  const start = (page - 1) * pageSize;
  const items = filtered.slice(start, start + pageSize);
  const counts = countServicesByStatus(mapped);
  return {
    items,
    total,
    totalAll: mapped.length,
    page,
    pageSize,
    counts,
  };
}

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  return await new Promise((resolve, reject) => {
    stream.on('data', (d: Buffer | string) => {
      chunks.push(Buffer.isBuffer(d) ? d : Buffer.from(d));
    });
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

async function normalizeDockerLogsStream(stream: unknown): Promise<string> {
  if (Buffer.isBuffer(stream)) {
    return stream.toString('utf8');
  }
  if (stream && typeof (stream as NodeJS.ReadableStream).on === 'function') {
    const buf = await streamToBuffer(stream as NodeJS.ReadableStream);
    return buf.toString('utf8');
  }
  return String(stream ?? '');
}

export async function remoteContainerLogs(
  docker: Dockerode,
  containerId: string,
  tail: number,
): Promise<string> {
  const c = docker.getContainer(containerId);
  const stream = await c.logs({
    stdout: true,
    stderr: true,
    tail,
    timestamps: false,
  });
  return normalizeDockerLogsStream(stream);
}

export async function remoteServiceLogs(
  docker: Dockerode,
  serviceId: string,
  tail: number,
): Promise<string> {
  const s = docker.getService(serviceId);
  const stream = await s.logs({
    stdout: true,
    stderr: true,
    tail,
    timestamps: false,
  });
  return normalizeDockerLogsStream(stream);
}

export async function removeRemoteContainer(
  docker: Dockerode,
  id: string,
  force: boolean,
): Promise<void> {
  await docker.getContainer(id).remove({ force });
}

export async function removeRemoteImage(
  docker: Dockerode,
  refOrId: string,
): Promise<void> {
  await docker.getImage(refOrId).remove({ force: true });
}

export async function removeRemoteVolume(
  docker: Dockerode,
  name: string,
  force: boolean,
): Promise<void> {
  await docker.getVolume(name).remove({ force });
}

export async function removeRemoteNetwork(
  docker: Dockerode,
  idOrName: string,
): Promise<void> {
  await docker.getNetwork(idOrName).remove({});
}

export async function removeRemoteService(
  docker: Dockerode,
  id: string,
  force: boolean,
): Promise<void> {
  await docker.getService(id).remove({ force });
}
