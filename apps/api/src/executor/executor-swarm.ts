import { Service } from '../services/entities/service.entity';
import { composeType } from '../services/entities/composeType.enum';

/** Swarm stack deploy path (same CLI as explicit Stack services + database-generated YAML). */
export function isSwarmStackService(service: Service): boolean {
  return (
    service.composeType === composeType.STACK ||
    service.composeType === composeType.DATABASES ||
    service.composeType === composeType.APPLICATION
  );
}
