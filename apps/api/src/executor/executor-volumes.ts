import type { ServiceVolumeMountDto } from '../services/dto/service-volume-mount.dto';

export function parseShortVolumeMountString(
  s: string,
): Omit<ServiceVolumeMountDto, 'composeService'> | null {
  const t = s.trim();
  if (!t) return null;
  const parts = t.split(':');
  if (parts.length < 2) return null;
  const source = parts[0];
  const target = parts[1];
  const mode = (parts[2] ?? '').toLowerCase();
  const readOnly = mode.includes('ro');
  const isBind =
    source.startsWith('.') ||
    source.startsWith('/') ||
    source.startsWith('~') ||
    /^[a-zA-Z]:[\\/]/.test(source);
  return {
    mountType: isBind ? 'bind' : 'volume',
    source,
    target,
    readOnly,
  };
}

export function flattenVolumesFromComposeJson(
  cfg: Record<string, unknown>,
): ServiceVolumeMountDto[] {
  const services = cfg['services'] as
    | Record<string, { volumes?: unknown[] }>
    | undefined;
  const volDefs = cfg['volumes'] as
    | Record<string, { name?: string }>
    | undefined;
  if (!services || typeof services !== 'object') return [];

  const out: ServiceVolumeMountDto[] = [];
  for (const [svcName, svc] of Object.entries(services)) {
    if (!svc || typeof svc !== 'object') continue;
    const vols = (svc as { volumes?: unknown[] }).volumes;
    if (!Array.isArray(vols)) continue;

    for (const v of vols) {
      if (typeof v === 'string') {
        const parsed = parseShortVolumeMountString(v);
        if (parsed) {
          out.push({ composeService: svcName, ...parsed });
        }
        continue;
      }
      if (!v || typeof v !== 'object') continue;
      const o = v as Record<string, unknown>;
      const typeRaw = String(o.type ?? 'unknown').toLowerCase();
      const mountType =
        typeRaw === 'bind'
          ? 'bind'
          : typeRaw === 'volume'
            ? 'volume'
            : typeRaw === 'tmpfs'
              ? 'tmpfs'
              : 'unknown';

      const source = String(o.source ?? '').trim() || '—';
      const target = String(o.target ?? '').trim() || '—';
      const readOnly = o.read_only === true;

      let hostVolumeName: string | undefined;
      if (mountType === 'volume' && volDefs && source !== '—') {
        const def = volDefs[source];
        if (def?.name) hostVolumeName = String(def.name);
      }

      out.push({
        composeService: svcName,
        mountType,
        source,
        target,
        readOnly,
        hostVolumeName,
      });
    }
  }

  return out;
}
