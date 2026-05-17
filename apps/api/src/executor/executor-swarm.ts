import { Service } from '../services/entities/service.entity';
import { composeType } from '../services/entities/composeType.enum';

/** Domains-tab routes require Swarm `deploy.labels` — Traefik defaults to swarmMode. */
export function composeServiceHasTraefikIngress(service: Service): boolean {
  return (
    service.composeType === composeType.COMPOSE &&
    ((service.traefikRoutes?.length ?? 0) > 0 ||
      (service.domains?.length ?? 0) > 0)
  );
}

/** Swarm stack deploy path (stack / databases / applications / compose with domains). */
export function isSwarmStackService(service: Service): boolean {
  return (
    service.composeType === composeType.STACK ||
    service.composeType === composeType.DATABASES ||
    service.composeType === composeType.APPLICATION ||
    composeServiceHasTraefikIngress(service)
  );
}
