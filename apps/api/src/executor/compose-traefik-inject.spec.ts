import { injectTraefikIntoComposeYaml } from './compose-traefik-inject';

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
    expect(out).toMatch(/networks:\s*\n\s+weehawk:\s*\n\s+external: true/);
  });

  it('skips when traefik labels already present', () => {
    const withLabels = `${pgadminCompose}
    deploy:
      labels:
        - "traefik.enable=true"
`;
    expect(
      injectTraefikIntoComposeYaml(withLabels, {
        targetServiceName: 'pgadmin',
        traefik,
        externalNetwork: 'weehawk',
      }),
    ).toBe(withLabels);
  });
});
