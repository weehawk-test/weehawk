import { isWeehawkTemplateService } from '../common/template-service';
import { Service } from '../services/entities/service.entity';
import { composeType } from '../services/entities/composeType.enum';

/** Domains-tab routes on advanced compose (non-template) use Swarm `deploy.labels`. */
export function composeServiceHasTraefikIngress(service: Service): boolean {
  if (isWeehawkTemplateService(service)) {
    return false;
  }
  return (
    service.composeType === composeType.COMPOSE &&
    ((service.traefikRoutes?.length ?? 0) > 0 ||
      (service.domains?.length ?? 0) > 0)
  );
}

/** Swarm stack deploy path (stack / databases / applications / compose with domains). */
export function isSwarmStackService(service: Service): boolean {
  if (isWeehawkTemplateService(service)) {
    return false;
  }
  return (
    service.composeType === composeType.STACK ||
    service.composeType === composeType.DATABASES ||
    service.composeType === composeType.APPLICATION ||
    composeServiceHasTraefikIngress(service)
  );
}
