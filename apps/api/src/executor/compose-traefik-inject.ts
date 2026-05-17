/**
 * Inject Traefik Docker labels and attach the external proxy network for compose deploys.
 */

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
      .some((l) => l.trim() === `- ${networkName}` || l.includes(networkName));
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

function ensureRootExternalNetwork(
  lines: string[],
  networkName: string,
): string[] {
  const declared = new Set<string>();
  let volumesIdx = lines.length;
  for (let i = 0; i < lines.length; i++) {
    if (/^networks:\s*(\{\})?\s*$/.test(lines[i]!)) {
      for (let j = i + 1; j < lines.length; j++) {
        const t = lines[j]!.trim();
        if (!t || t.startsWith('#')) continue;
        if (/^\S/.test(lines[j]!) && !/^[a-zA-Z_][\w.-]*:\s*$/.test(t)) break;
        const km = t.match(/^([a-zA-Z_][\w.-]*):\s*$/);
        if (km) declared.add(km[1]!);
      }
      break;
    }
    if (/^volumes:\s*/.test(lines[i]!)) volumesIdx = i;
  }
  if (declared.has(networkName)) return lines;

  const block = [
    'networks:',
    `  ${networkName}:`,
    '    external: true',
  ];
  const out = [...lines];
  if (declared.size > 0) {
    out.push(`  ${networkName}:`, '    external: true');
    return out;
  }
  out.splice(volumesIdx, 0, ...block, '');
  return out;
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

  let lines = raw.split(/\r?\n/);
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
    return composeYaml;
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
  block.end += labelLines.length;

  lines = ensureServiceNetworkAttached(lines, block, options.externalNetwork);
  lines = ensureRootExternalNetwork(lines, options.externalNetwork);

  return `${lines.join('\n').replace(/\s*$/, '')}\n`;
}
