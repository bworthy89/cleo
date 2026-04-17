import { getPersistedBroadcast, clearPersistedBroadcast } from '../services/Storage';
import type { Manifest } from './BroadcastPlayer.types';

const RESUME_WINDOW_MS = 2 * 60 * 60 * 1000;

export class BroadcastResumer {
  async check(): Promise<Manifest | null> {
    const m = getPersistedBroadcast();
    if (!m) return null;
    if (Date.now() - m.createdAt > RESUME_WINDOW_MS) {
      clearPersistedBroadcast();
      return null;
    }
    return m;
  }

  async decline(): Promise<void> {
    clearPersistedBroadcast();
  }
}
