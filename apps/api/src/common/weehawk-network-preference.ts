import { WEEHAWK_TRAEFIK_EXTERNAL_NETWORK } from '../traefik/traefik.constants';

export type WeehawkNetworkMode = 'attach' | 'standalone';

export const WEEHAWK_NETWORK_HEADER = 'network.weehawk';

/** Parse `# network.weehawk: attach|standalone` (legacy: `weehawk` in app.networks.external). */
export function parseWeehawkNetworkMode(
  config: string,
  opts?: { defaultMode?: WeehawkNetworkMode },
): WeehawkNetworkMode {
  const raw = config || '';
  const explicit = raw
    .match(/^\s*#\s*network\.weehawk:\s*(attach|standalone)\s*$/im)?.[1]
    ?.toLowerCase();
  if (explicit === 'attach' || explicit === 'standalone') return explicit;

  const extLine = raw.match(/^\s*#\s*app\.networks\.external:\s*(.+)$/m)?.[1];
  if (extLine) {
    const names = extLine
      .split('|')
      .map((s) => s.trim())
      .filter(Boolean);
    return names.includes(WEEHAWK_TRAEFIK_EXTERNAL_NETWORK)
      ? 'attach'
      : 'standalone';
  }

  return opts?.defaultMode ?? 'standalone';
}

export function weehawkNetworkHeaderLine(mode: WeehawkNetworkMode): string {
  return `# ${WEEHAWK_NETWORK_HEADER}: ${mode}\n`;
}

export function externalNetworksWithoutWeehawk(names: string[]): string[] {
  const proxy = WEEHAWK_TRAEFIK_EXTERNAL_NETWORK;
  return names
    .map((n) => n.trim())
    .filter((n) => n.length > 0 && n !== proxy);
}

export function mergeWeehawkExternalNetwork(
  names: string[],
  attach: boolean,
): string[] {
  const base = externalNetworksWithoutWeehawk(names);
  if (!attach) return base;
  return [...base, WEEHAWK_TRAEFIK_EXTERNAL_NETWORK];
}

export function isWeehawkNetworkAttached(config: string): boolean {
  return parseWeehawkNetworkMode(config) === 'attach';
}
