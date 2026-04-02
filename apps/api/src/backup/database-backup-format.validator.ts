import { ValidatorConstraint } from 'class-validator';
import type {
  ValidationArguments,
  ValidatorConstraintInterface,
} from 'class-validator';
import type { DatabaseBackupEngine } from './database-backup.types';
import { isValidBackupFormatForEngine } from './database-backup.types';

@ValidatorConstraint({ name: 'backupFormatMatchesEngine', async: false })
export class BackupFormatMatchesEngine implements ValidatorConstraintInterface {
  validate(value: unknown, args: ValidationArguments): boolean {
    const o = args.object as { engine?: DatabaseBackupEngine };
    if (!o.engine) return true;
    return isValidBackupFormatForEngine(o.engine, value);
  }

  defaultMessage(): string {
    return 'backupFormat is invalid for this engine.';
  }
}
