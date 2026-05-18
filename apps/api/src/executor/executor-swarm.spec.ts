import { composeType } from '../services/entities/composeType.enum';
import type { Service } from '../services/entities/service.entity';
import {
  composeServiceHasTraefikIngress,
  isSwarmStackService,
} from './executor-swarm';

function baseService(overrides: Partial<Service> = {}): Service {
  return {
    id: 1,
    composeType: composeType.COMPOSE,
    dockerConfig: '',
    traefikRoutes: [],
    domains: [],
    ...overrides,
  } as Service;
}

describe('executor-swarm', () => {
  it('treats catalog templates as compose even with domains', () => {
    const svc = baseService({
      dockerConfig: '# weehawk template service\n# template: n8n\nservices:\n  n8n:\n    image: n8nio/n8n',
      traefikRoutes: [
        {
          router: 'n8n',
          hosts: ['n8n.example.com'],
          port: 5678,
          https: true,
        },
      ],
    });
    expect(composeServiceHasTraefikIngress(svc)).toBe(false);
    expect(isSwarmStackService(svc)).toBe(false);
  });

  it('still uses swarm for advanced compose with domains', () => {
    const svc = baseService({
      dockerConfig: 'services:\n  app:\n    image: nginx',
      domains: ['app.example.com'],
    });
    expect(composeServiceHasTraefikIngress(svc)).toBe(true);
    expect(isSwarmStackService(svc)).toBe(true);
  });
});
