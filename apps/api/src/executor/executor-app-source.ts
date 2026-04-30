import type { ConfigService } from '@nestjs/config';
import * as fs from 'fs/promises';
import * as path from 'path';
import { composeType } from '../services/entities/composeType.enum';
import type { Service } from '../services/entities/service.entity';
import { parseConfigHeaderValue } from './executor-compose-parse';

/** Default true: delete `app-source` after a successful application stack deploy to free disk. Set `WEEHAWK_REMOVE_APP_SOURCE_AFTER_DEPLOY=false` to keep sources for rebuilds without re-upload. */
export function shouldRemoveAppSourceAfterDeploy(
  configService: ConfigService,
): boolean {
  const v = (
    configService.get<string>('WEEHAWK_REMOVE_APP_SOURCE_AFTER_DEPLOY') ??
    'true'
  )
    .toLowerCase()
    .trim();
  return v !== 'false' && v !== '0' && v !== 'no';
}

export async function maybeRemoveApplicationSourceAfterDeploy(
  service: Service,
  deployDir: string,
  configService: ConfigService,
): Promise<void> {
  if (!shouldRemoveAppSourceAfterDeploy(configService)) return;
  if (service.composeType !== composeType.APPLICATION) return;
  const rawConfig = service.dockerConfig || '';
  const sourceDirRel =
    parseConfigHeaderValue(rawConfig, 'sourceDir') || 'app-source';
  const abs = path.join(deployDir, sourceDirRel);
  try {
    await fs.rm(abs, { recursive: true, force: true });
  } catch {
    /* best-effort cleanup */
  }
}
