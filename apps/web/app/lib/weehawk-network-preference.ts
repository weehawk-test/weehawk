export type WeehawkNetworkMode = "attach" | "standalone";

export const WEEHAWK_PROXY_NETWORK_NAME = "weehawk";

/** Parse `# network.weehawk: attach|standalone` (legacy: `weehawk` in app.networks.external). */
export function parseWeehawkNetworkMode(
  config: string,
  opts?: { defaultMode?: WeehawkNetworkMode },
): WeehawkNetworkMode {
  const raw = config || "";
  const explicit = raw
    .match(/^\s*#\s*network\.weehawk:\s*(attach|standalone)\s*$/im)?.[1]
    ?.toLowerCase();
  if (explicit === "attach" || explicit === "standalone") return explicit;

  const extLine = raw.match(/^\s*#\s*app\.networks\.external:\s*(.+)$/m)?.[1];
  if (extLine) {
    const names = extLine
      .split("|")
      .map((s) => s.trim())
      .filter(Boolean);
    return names.includes(WEEHAWK_PROXY_NETWORK_NAME) ? "attach" : "standalone";
  }

  return opts?.defaultMode ?? "standalone";
}

export function externalNetworksWithoutWeehawk(names: string[]): string[] {
  return names
    .map((n) => n.trim())
    .filter((n) => n.length > 0 && n !== WEEHAWK_PROXY_NETWORK_NAME);
}

export function isWeehawkNetworkAttached(config: string): boolean {
  return parseWeehawkNetworkMode(config) === "attach";
}
