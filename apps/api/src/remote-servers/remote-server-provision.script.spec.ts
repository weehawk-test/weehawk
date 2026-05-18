import {
  buildTraefikFileProviderPostDeployBash,
  buildTraefikRedeployScript,
  buildTraefikStackYaml,
  buildTraefikStaticYaml,
  buildWeehawkProvisionScript,
} from './remote-server-provision.script';
import { WEEHAWK_TRAEFIK_DYNAMIC_HOST_PATH } from '../traefik/traefik.constants';

describe('remote-server-provision.script Traefik', () => {
  it('buildTraefikStaticYaml always enables file provider', () => {
    const yaml = buildTraefikStaticYaml({
      acmeEmail: 'a@b.com',
      dockerNetwork: 'weehawk',
    });
    expect(yaml).toContain('swarmMode: true');
    expect(yaml).toContain('file:');
    expect(yaml).toContain('directory: /etc/traefik/dynamic');
    expect(yaml).toContain('watch: true');
  });

  it('buildTraefikStackYaml always mounts dynamic directory', () => {
    const stack = buildTraefikStackYaml({ dockerNetwork: 'weehawk' });
    expect(stack).toContain(
      `${WEEHAWK_TRAEFIK_DYNAMIC_HOST_PATH}:/etc/traefik/dynamic`,
    );
  });

  it('deploy provision script includes file provider verify after traefik deploy', () => {
    const script = buildWeehawkProvisionScript({
      role: 'deploy',
      acmeEmail: 'a@b.com',
      isProvisionJobPreview: true,
      webhookAgent: { mode: 'none' },
    });
    expect(script).toContain('directory: /etc/traefik/dynamic');
    expect(script).toContain(WEEHAWK_TRAEFIK_DYNAMIC_HOST_PATH);
    expect(script).toContain('Traefik file provider ready');
  });

  it('traefik redeploy script verifies file provider', () => {
    const script = buildTraefikRedeployScript({ acmeEmail: 'a@b.com' });
    expect(script).toContain('Traefik file provider ready');
    expect(script).toContain('traefik-stack.yml');
  });

  it('post-deploy bash checks traefik.yml and stack mount', () => {
    const bash = buildTraefikFileProviderPostDeployBash();
    expect(bash).toContain('traefik.yml missing file provider');
    expect(bash).toContain('traefik-stack.yml missing dynamic volume');
  });
});
