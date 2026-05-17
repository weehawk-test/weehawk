/**
 * Inject Traefik Docker labels and attach the external proxy network for compose deploys.
 */

/** Shared overlay so db/redis stay reachable when the app service also joins Traefik's network. */
export const STACK_INTERNAL_NETWORK_NAME = 'weehawk-internal';

export type ComposeTraefikIngress = {
  certResolver: string;
  httpEntrypoint: string;
  httpsEntrypoint: string;
  routes: Array<{
    router: string;
    rule: string;
    port: number;
    https: boolean;
  }>;
};

function escapeTraefikLabelValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/** Swarm stack `deploy.labels` (Traefik on Weehawk hosts uses `providers.docker.swarmMode`). */
export function buildSwarmTraefikDeployBlock(
  traefik: ComposeTraefikIngress,
  dockerNetwork: string,
): string[] {
  const lines: string[] = [
    '    deploy:',
    '      replicas: 1',
    '      restart_policy:',
    '        condition: on-failure',
    '      labels:',
    '        - "traefik.enable=true"',
    `        - "traefik.docker.network=${dockerNetwork}"`,
  ];
  const lbPortsSeen = new Set<number>();
  for (const r of traefik.routes) {
    const ruleEsc = escapeTraefikLabelValue(r.rule);
    const useTls = r.https !== false;
    const ep = useTls ? traefik.httpsEntrypoint : traefik.httpEntrypoint;
    const lbSvc = `whlb_${r.port}`;
    lines.push(
      `        - "traefik.http.routers.${r.router}.rule=${ruleEsc}"`,
    );
    lines.push(
      `        - "traefik.http.routers.${r.router}.entrypoints=${ep}"`,
    );
    lines.push(
      `        - "traefik.http.routers.${r.router}.service=${lbSvc}"`,
    );
    if (useTls) {
      lines.push(
        `        - "traefik.http.routers.${r.router}.tls.certresolver=${traefik.certResolver}"`,
      );
    }
    if (!lbPortsSeen.has(r.port)) {
      lbPortsSeen.add(r.port);
      lines.push(
        `        - "traefik.http.services.${lbSvc}.loadbalancer.server.port=${r.port}"`,
      );
    }
  }
  return lines;
}

function findServicesSection(lines: string[]): {
  start: number;
  indent: number;
} | null {
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i]!.match(/^(\s*)services:\s*$/);
    if (m) return { start: i, indent: m[1]!.length };
  }
  return null;
}

function findServiceBlockRange(
  lines: string[],
  servicesStart: number,
  servicesIndent: number,
  serviceName: string,
): { start: number; end: number; childIndent: number } | null {
  const nameRe = new RegExp(
    `^\\s{${servicesIndent + 2}}${serviceName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:\\s*$`,
  );
  let start = -1;
  let childIndent = servicesIndent + 4;
  for (let i = servicesStart + 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (nameRe.test(line)) {
      start = i;
      childIndent = (line.match(/^\s*/)?.[0]?.length ?? 0) + 2;
      break;
    }
  }
  if (start < 0) return null;

  let end = lines.length;
  const siblingRe = new RegExp(`^\\s{${servicesIndent + 2}}[a-zA-Z0-9_.-]+:\\s*$`);
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const indent = line.match(/^\s*/)?.[0]?.length ?? 0;
    if (indent <= servicesIndent && line.trim()) {
      end = i;
      break;
    }
    if (siblingRe.test(line)) {
      end = i;
      break;
    }
  }
  return { start, end, childIndent };
}

function serviceBlockHasTraefikEnable(
  lines: string[],
  start: number,
  end: number,
): boolean {
  for (let i = start + 1; i < end; i++) {
    if (/traefik\.enable\s*=\s*true/i.test(lines[i]!)) return true;
  }
  return false;
}

function ensureServiceNetworkAttached(
  lines: string[],
  block: { start: number; end: number; childIndent: number },
  networkName: string,
): string[] {
  const netKey = ' '.repeat(block.childIndent) + 'networks:';
  const netItem = ' '.repeat(block.childIndent + 2) + `- ${networkName}`;
  let netLine = -1;
  for (let i = block.start + 1; i < block.end; i++) {
    if (lines[i]!.trim() === 'networks:') {
      netLine = i;
      break;
    }
  }
  if (netLine >= 0) {
    const hasNet = lines
      .slice(netLine + 1, block.end)
      .some((l) => l.trim() === `- ${networkName}`);
    if (hasNet) return lines;
    const out = [...lines];
    out.splice(netLine + 1, 0, netItem);
    if (block.end > netLine) block.end += 1;
    return out;
  }
  const out = [...lines];
  out.splice(block.end, 0, netKey, netItem);
  block.end += 2;
  return out;
}

function listComposeServiceNames(
  lines: string[],
  services: { start: number; indent: number },
): string[] {
  const names: string[] = [];
  const nameRe = new RegExp(
    `^\\s{${services.indent + 2}}([a-zA-Z0-9][a-zA-Z0-9_.-]*):\\s*$`,
  );
  for (let i = services.start + 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const indent = line.match(/^\s*/)?.[0]?.length ?? 0;
    if (indent <= services.indent) break;
    const m = line.match(nameRe);
    if (m) names.push(m[1]!);
  }
  return names;
}

function findNetworksSectionBounds(lines: string[]): {
  headerIdx: number;
  insertIdx: number;
  declared: Set<string>;
} | null {
  for (let i = 0; i < lines.length; i++) {
    if (!/^networks:\s*(\{\})?\s*$/.test(lines[i]!)) continue;
    const headerIndent = lines[i]!.match(/^\s*/)?.[0]?.length ?? 0;
    const declared = new Set<string>();
    let insertIdx = i + 1;
    for (let j = i + 1; j < lines.length; j++) {
      const line = lines[j]!;
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const indent = line.match(/^\s*/)?.[0]?.length ?? 0;
      if (indent <= headerIndent && /^[a-zA-Z_][\w.-]*:\s*$/.test(trimmed)) {
        insertIdx = j;
        break;
      }
      const km = trimmed.match(/^([a-zA-Z_][\w.-]*):\s*$/);
      if (km && indent > headerIndent) {
        declared.add(km[1]!);
        insertIdx = j + 1;
      }
    }
    return { headerIdx: i, insertIdx, declared };
  }
  return null;
}

function indexBeforeVolumesOrAppend(lines: string[]): number {
  for (let i = 0; i < lines.length; i++) {
    if (/^volumes:\s*/.test(lines[i]!)) return i;
  }
  return lines.length;
}

/** Insert a network under top-level `networks:` (never append after `volumes:`). */
function ensureNetworkDeclared(
  lines: string[],
  networkName: string,
  specLines: string[],
): string[] {
  const section = findNetworksSectionBounds(lines);
  if (section?.declared.has(networkName)) return lines;

  const block = [`  ${networkName}:`, ...specLines];
  const out = [...lines];
  if (section) {
    out.splice(section.insertIdx, 0, ...block);
    return out;
  }
  const at = indexBeforeVolumesOrAppend(lines);
  out.splice(at, 0, 'networks:', ...block, '');
  return out;
}

function ensureRootOverlayNetwork(
  lines: string[],
  networkName: string,
): string[] {
  return ensureNetworkDeclared(lines, networkName, ['    driver: overlay']);
}

function ensureRootExternalNetwork(
  lines: string[],
  networkName: string,
): string[] {
  return ensureNetworkDeclared(lines, networkName, [
    '    external: true',
    `    name: ${networkName}`,
  ]);
}

/** Attach every service to the stack overlay (required before Traefik-only network on the app). */
function attachAllServicesToStackNetwork(
  lines: string[],
  networkName: string,
): string[] {
  let result = lines;
  const services = findServicesSection(result);
  if (!services) return result;
  for (const name of listComposeServiceNames(result, services)) {
    const svc = findServicesSection(result);
    if (!svc) break;
    const block = findServiceBlockRange(result, svc.start, svc.indent, name);
    if (!block) continue;
    result = ensureServiceNetworkAttached(result, block, networkName);
  }
  return result;
}

/**
 * Attach every service to the internal overlay + external Traefik network (template stacks).
 */
export function attachAllServicesToWeehawkStackNetworks(
  composeYaml: string,
  externalNetwork: string,
): string {
  const raw = (composeYaml || '').trim();
  if (!raw) return composeYaml;

  let lines = raw.split(/\r?\n/);
  const services = findServicesSection(lines);
  if (!services) return composeYaml;

  lines = ensureRootOverlayNetwork(lines, STACK_INTERNAL_NETWORK_NAME);
  lines = ensureRootExternalNetwork(lines, externalNetwork);
  lines = attachAllServicesToStackNetwork(lines, STACK_INTERNAL_NETWORK_NAME);
  lines = attachAllServicesToStackNetwork(lines, externalNetwork);

  return `${lines.join('\n').replace(/\s*$/, '')}\n`;
}

/**
 * Add Traefik labels and proxy network to a compose service (does not mutate DB storage).
 */
export function injectTraefikIntoComposeYaml(
  composeYaml: string,
  options: {
    targetServiceName: string;
    traefik: ComposeTraefikIngress;
    externalNetwork: string;
  },
): string {
  const raw = (composeYaml || '').trim();
  if (!raw || !options.traefik.routes.length) return composeYaml;

  let lines = attachAllServicesToWeehawkStackNetworks(
    raw,
    options.externalNetwork,
  ).split(/\r?\n/);
  const services = findServicesSection(lines);
  if (!services) return composeYaml;

  const block = findServiceBlockRange(
    lines,
    services.start,
    services.indent,
    options.targetServiceName,
  );
  if (!block) return composeYaml;

  if (serviceBlockHasTraefikEnable(lines, block.start, block.end)) {
    return `${lines.join('\n').replace(/\s*$/, '')}\n`;
  }

  const labelLines = buildSwarmTraefikDeployBlock(
    options.traefik,
    options.externalNetwork,
  );
  lines = [
    ...lines.slice(0, block.end),
    ...labelLines,
    ...lines.slice(block.end),
  ];

  return `${lines.join('\n').replace(/\s*$/, '')}\n`;
}
