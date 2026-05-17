import {
  attachAllServicesToWeehawkStackNetworks,
  injectTraefikIntoComposeYaml,
  STACK_INTERNAL_NETWORK_NAME,
} from './compose-traefik-inject';

describe('compose-traefik-inject', () => {
  const pgadminCompose = `
services:
  pgadmin:
    image: dpage/pgadmin4:latest
    volumes:
      - pgadmin-data:/var/lib/pgadmin
`.trim();

  const traefik = {
    certResolver: 'letsencrypt',
    httpEntrypoint: 'web',
    httpsEntrypoint: 'websecure',
    routes: [
      {
        router: 'pgadmin',
        rule: 'Host(`pgadmin.example.com`)',
        port: 80,
        https: true,
      },
    ],
  };

  it('injects swarm deploy.labels and weehawk network', () => {
    const out = injectTraefikIntoComposeYaml(pgadminCompose, {
      targetServiceName: 'pgadmin',
      traefik,
      externalNetwork: 'weehawk',
    });
    expect(out).toContain('deploy:');
    expect(out).toContain('replicas: 1');
    expect(out).toContain('traefik.enable=true');
    expect(out).toContain('traefik.docker.network=weehawk');
    expect(out).toContain('Host(`pgadmin.example.com`)');
    expect(out).toContain('- weehawk');
    expect(out).toContain('- weehawk-internal');
    expect(out).toMatch(/weehawk:\s*\n\s+external: true/);
  });

  it('keeps multi-service DNS when attaching traefik network (infisical-style)', () => {
    const infisical = `
services:
  backend:
    image: infisical/infisical:latest
  db:
    image: postgres:14-alpine
  redis:
    image: redis:7
`.trim();
    const out = injectTraefikIntoComposeYaml(infisical, {
      targetServiceName: 'backend',
      traefik,
      externalNetwork: 'weehawk',
    });
    expect(out).toContain(`${STACK_INTERNAL_NETWORK_NAME}:`);
    expect(out).toContain('driver: overlay');
    expect(out).toMatch(/backend:[\s\S]*?- weehawk-internal/);
    expect(out).toMatch(/backend:[\s\S]*?- weehawk/);
    expect(out).toMatch(/db:[\s\S]*?- weehawk-internal/);
    expect(out).toMatch(/redis:[\s\S]*?- weehawk-internal/);
    expect(out).toMatch(/db:[\s\S]*?- weehawk/);
    expect(out).toMatch(/redis:[\s\S]*?- weehawk/);
  });

  it('declares weehawk under networks (not volumes) when volumes exist', () => {
    const withVolumes = `
services:
  redis:
    image: redis:7
volumes:
  redis-data:
`.trim();
    const out = attachAllServicesToWeehawkStackNetworks(withVolumes, 'weehawk');
    const networksIdx = out.indexOf('networks:');
    const volumesIdx = out.indexOf('volumes:');
    const weehawkExternalIdx = out.indexOf('  weehawk:\n    external: true');
    expect(networksIdx).toBeGreaterThan(-1);
    expect(volumesIdx).toBeGreaterThan(networksIdx);
    expect(weehawkExternalIdx).toBeGreaterThan(networksIdx);
    expect(weehawkExternalIdx).toBeLessThan(volumesIdx);
    expect(out).toContain('name: weehawk');
  });

  it('attachAllServicesToWeehawkStackNetworks wires every service without traefik labels', () => {
    const infisical = `
services:
  backend:
    image: infisical/infisical:latest
  db:
    image: postgres:14-alpine
`.trim();
    const out = attachAllServicesToWeehawkStackNetworks(infisical, 'weehawk');
    expect(out).not.toContain('traefik.enable');
    expect(out).toMatch(/backend:[\s\S]*?- weehawk/);
    expect(out).toMatch(/db:[\s\S]*?- weehawk/);
  });

  it('skips duplicate traefik labels but still attaches stack networks', () => {
    const withLabels = `${pgadminCompose}
    deploy:
      labels:
        - "traefik.enable=true"
`;
    const out = injectTraefikIntoComposeYaml(withLabels, {
      targetServiceName: 'pgadmin',
      traefik,
      externalNetwork: 'weehawk',
    });
    expect(out.match(/traefik\.enable/g)?.length).toBe(1);
    expect(out).toContain('- weehawk');
    expect(out).toContain('- weehawk-internal');
  });
});
