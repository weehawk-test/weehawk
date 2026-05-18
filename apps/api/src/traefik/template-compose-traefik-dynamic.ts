import type { ComposeTraefikIngress } from '../executor/compose-traefik-inject';
import { toSafePathSegment } from '../services/deployment-paths';

/** Traefik file-provider fragment for one template compose project (Swarm-mode Traefik cannot read container labels). */
export function templateComposeTraefikDynamicFilename(appName: string): string {
  return `weehawk-compose-${toSafePathSegment(appName || 'service')}.yml`;
}

/** Stable DNS name on the `weehawk` overlay for file-provider backends. */
export function templateComposeTraefikContainerName(
  appName: string,
  composeServiceName: string,
): string {
  return `wh-${toSafePathSegment(appName)}-${toSafePathSegment(composeServiceName)}`;
}

export function buildTemplateComposeTraefikDynamicYaml(
  traefik: ComposeTraefikIngress,
  targetServiceName: string,
  containerName: string,
): string {
  if (!traefik.routes.length) return '';

  const lines: string[] = [
    '## Weehawk — template compose (file provider)',
    'http:',
    '  routers:',
  ];

  const serviceBlocks: string[] = ['  services:'];

  for (const r of traefik.routes) {
    const routerId = `wh-tpl-${r.router}`;
    const svcId = `${routerId}-svc`;
    const useTls = r.https !== false;
    const ep = useTls ? traefik.httpsEntrypoint : traefik.httpEntrypoint;
    lines.push(`    ${routerId}:`);
    lines.push(`      rule: ${r.rule}`);
    lines.push('      entryPoints:');
    lines.push(`        - ${ep}`);
    lines.push(`      service: ${svcId}`);
    if (useTls) {
      lines.push('      tls:');
      lines.push(`        certResolver: ${traefik.certResolver}`);
    }
    serviceBlocks.push(`    ${svcId}:`);
    serviceBlocks.push('      loadBalancer:');
    serviceBlocks.push('        servers:');
    serviceBlocks.push(
      `          - url: "http://${containerName}:${r.port}"`,
    );
  }

  return `${lines.join('\n')}\n${serviceBlocks.join('\n')}\n`;
}
