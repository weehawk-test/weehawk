/** Mirrors frontend `app/lib/docker-api.ts` mapping for Docker CLI JSON rows. */

export type ContainerStatus = 'running' | 'stopped' | 'exited';

export interface DockerContainerDto {
  id: string;
  name: string;
  image: string;
  status: ContainerStatus;
  ports: string;
  createdAt: string;
}

export interface DockerImageDto {
  id: string;
  repository: string;
  tag: string;
  imageId: string;
  imageIdFull: string;
  size: string;
  createdAt: string;
}

export interface DockerVolumeDto {
  id: string;
  name: string;
  size: string;
  createdAt: string;
}

export interface DockerNetworkDto {
  /** Full network ID from Docker (64 hex). */
  id: string;
  networkIdShort: string;
  name: string;
  driver: string;
  scope: string;
  internal: boolean;
  ipv6: boolean;
  createdAt: string;
}

function pickStr(row: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    const v = row[k];
    if (v !== undefined && v !== null && String(v).length > 0) return String(v);
  }
  return '';
}

function mapContainerStatus(status: string): ContainerStatus {
  const s = status.toLowerCase();
  if (s.startsWith('up') || s.includes('running')) return 'running';
  if (s.startsWith('exited') || s.includes('dead')) return 'exited';
  return 'stopped';
}

function normalizeName(names: string): string {
  const n = names.split(',')[0]?.trim() ?? '';
  return n.replace(/^\//, '') || '—';
}

export function mapDockerPsRow(
  row: Record<string, unknown>,
  index: number,
): DockerContainerDto {
  const status = pickStr(row, 'Status', 'State');
  const names = pickStr(row, 'Names');
  const created = pickStr(row, 'CreatedAt', 'RunningFor');
  const fullId = pickStr(row, 'ID', 'Id');
  return {
    id: fullId || `container-${index}`,
    name: normalizeName(names),
    image: pickStr(row, 'Image') || '—',
    status: mapContainerStatus(status || 'unknown'),
    ports: pickStr(row, 'Ports') || '—',
    createdAt: created || new Date().toISOString(),
  };
}

function normalizeImageIdFull(raw: string): string {
  const t = raw.trim();
  if (!t) return '';
  if (/^sha256:[a-f0-9]{64}$/i.test(t))
    return `sha256:${t.slice(7).toLowerCase()}`;
  if (/^[a-f0-9]{64}$/i.test(t)) return `sha256:${t.toLowerCase()}`;
  return t;
}

function shortImageIdForDisplay(full: string): string {
  if (!full) return '—';
  if (/^sha256:/i.test(full)) return full.slice(7, 19);
  return full.slice(0, 12);
}

export function mapDockerImageRow(
  row: Record<string, unknown>,
  index: number,
): DockerImageDto {
  const repo = pickStr(row, 'Repository');
  const tag = pickStr(row, 'Tag') || 'latest';
  const idRaw = pickStr(row, 'ID', 'Id');
  const imageIdFull = normalizeImageIdFull(idRaw);
  return {
    id: `${repo}:${tag}:${index}`,
    repository: repo || '<none>',
    tag,
    imageId: shortImageIdForDisplay(imageIdFull || idRaw) || '—',
    imageIdFull: imageIdFull || idRaw.trim(),
    size: pickStr(row, 'Size') || '—',
    createdAt:
      pickStr(row, 'CreatedAt', 'CreatedSince') || new Date().toISOString(),
  };
}

function normalizeVolumeCreatedAt(raw: string): string {
  if (!raw.trim()) return new Date().toISOString();
  const ms = Date.parse(raw);
  if (!Number.isNaN(ms)) return new Date(ms).toISOString();
  return raw;
}

export function mapDockerVolumeRow(
  row: Record<string, unknown>,
  index: number,
): DockerVolumeDto {
  const name = pickStr(row, 'Name');
  const sizeRaw = pickStr(row, 'Size');
  const size =
    sizeRaw && !/^N\/A$/i.test(sizeRaw.trim()) ? sizeRaw.trim() : '—';
  const createdRaw = pickStr(row, 'CreatedAt', 'Created');
  return {
    id: name || `vol-${index}`,
    name: name || '—',
    size,
    createdAt: normalizeVolumeCreatedAt(createdRaw),
  };
}

export function mapRawRowsToContainers(raw: unknown[]): DockerContainerDto[] {
  return raw.map((item, i) =>
    mapDockerPsRow(item as Record<string, unknown>, i),
  );
}

export function mapRawRowsToImages(raw: unknown[]): DockerImageDto[] {
  return raw.map((item, i) =>
    mapDockerImageRow(item as Record<string, unknown>, i),
  );
}

export function mapRawRowsToVolumes(raw: unknown[]): DockerVolumeDto[] {
  return raw.map((item, i) =>
    mapDockerVolumeRow(item as Record<string, unknown>, i),
  );
}

function parseBoolish(v: unknown): boolean {
  if (v === true || v === 1) return true;
  if (v === false || v === 0) return false;
  const s = String(v).trim().toLowerCase();
  return s === 'true' || s === '1' || s === 'yes';
}

function normalizeNetworkCreatedAt(raw: string): string {
  const t = raw.trim();
  if (!t) return new Date().toISOString();
  let ms = Date.parse(t);
  if (!Number.isNaN(ms)) return new Date(ms).toISOString();
  const m = t.match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})/);
  if (m) {
    ms = Date.parse(`${m[1]}T${m[2]}Z`);
    if (!Number.isNaN(ms)) return new Date(ms).toISOString();
  }
  return t;
}

function shortNetworkId(full: string): string {
  const t = full.replace(/^sha256:/i, '').trim();
  if (t.length >= 12) return t.slice(0, 12);
  return t || '—';
}

export function mapDockerNetworkRow(
  row: Record<string, unknown>,
  index: number,
): DockerNetworkDto {
  const fullId = pickStr(row, 'ID', 'Id');
  const name = pickStr(row, 'Name');
  return {
    id: fullId || `net-${index}`,
    networkIdShort: shortNetworkId(fullId) || `net-${index}`,
    name: name || '—',
    driver: pickStr(row, 'Driver') || '—',
    scope: pickStr(row, 'Scope') || '—',
    internal: parseBoolish(row.Internal),
    ipv6: parseBoolish(row.IPv6),
    createdAt: normalizeNetworkCreatedAt(pickStr(row, 'CreatedAt', 'Created')),
  };
}

export function mapRawRowsToNetworks(raw: unknown[]): DockerNetworkDto[] {
  return raw.map((item, i) =>
    mapDockerNetworkRow(item as Record<string, unknown>, i),
  );
}

export function filterContainers(
  items: DockerContainerDto[],
  q: string,
): DockerContainerDto[] {
  const s = q.trim().toLowerCase();
  if (!s) return items;
  return items.filter(
    (c) =>
      c.name.toLowerCase().includes(s) || c.image.toLowerCase().includes(s),
  );
}

export function filterImages(
  items: DockerImageDto[],
  q: string,
): DockerImageDto[] {
  const s = q.trim().toLowerCase();
  if (!s) return items;
  return items.filter(
    (img) =>
      img.repository.toLowerCase().includes(s) ||
      img.tag.toLowerCase().includes(s),
  );
}

export function filterVolumes(
  items: DockerVolumeDto[],
  q: string,
): DockerVolumeDto[] {
  const s = q.trim().toLowerCase();
  if (!s) return items;
  return items.filter((v) => v.name.toLowerCase().includes(s));
}

export function filterNetworks(
  items: DockerNetworkDto[],
  q: string,
): DockerNetworkDto[] {
  const s = q.trim().toLowerCase();
  if (!s) return items;
  return items.filter(
    (n) =>
      n.name.toLowerCase().includes(s) ||
      n.driver.toLowerCase().includes(s) ||
      n.scope.toLowerCase().includes(s) ||
      n.id.toLowerCase().includes(s) ||
      n.networkIdShort.toLowerCase().includes(s),
  );
}
