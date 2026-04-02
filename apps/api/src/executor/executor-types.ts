import type { EventEmitter } from 'events';

export type ExecuteDeployOptions = {
  /** When set, build steps emit `data` (string chunks) for streaming UIs. */
  deployLogEmitter?: EventEmitter;
};
