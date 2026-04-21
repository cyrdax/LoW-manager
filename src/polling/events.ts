import { EventEmitter } from 'node:events';
import type { CharacterStatus } from '../types.ts';

type Events = {
  status: [Partial<CharacterStatus> & { characterId: number }];
  removed: [{ characterId: number }];
};

class StatusBus extends EventEmitter<Events> {}

export const bus = new StatusBus();
bus.setMaxListeners(50);
