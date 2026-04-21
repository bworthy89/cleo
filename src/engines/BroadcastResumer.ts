import { getPersistedBroadcast, clearPersistedBroadcast } from '../services/Storage';
import type { Manifest } from './BroadcastPlayer.types';
import { BroadcastManifestClient } from './BroadcastManifestClient';

const RESUME_WINDOW_MS = 2 * 60 * 60 * 1000;

export interface ResumeCheckResult {
  /** Freshest manifest from the server — slots may have flipped
   *  pending→ready since the manifest was persisted. Always prefer
   *  this over the locally persisted one. */
  manifest: Manifest;
  trackCursor: number;
}

export class BroadcastResumer {
  private readonly client: Pick<BroadcastManifestClient, 'fetchManifest'>;

  constructor(client?: Pick<BroadcastManifestClient, 'fetchManifest'>) {
    this.client = client ?? new BroadcastManifestClient();
  }

  /** Returns { fresh manifest, cursor } when: the local resume window
   *  is alive AND the server still has the broadcast (non-404). Returns
   *  null otherwise. Network / 5xx errors keep the persisted record
   *  intact and return the persisted manifest optimistically so flaky
   *  connections don't destroy a legit resume. */
  async check(): Promise<ResumeCheckResult | null> {
    const rec = getPersistedBroadcast();
    if (!rec) return null;
    if (Date.now() - rec.manifest.createdAt > RESUME_WINDOW_MS) {
      clearPersistedBroadcast();
      return null;
    }
    try {
      const fresh = await this.client.fetchManifest(rec.manifest.broadcastId);
      return { manifest: fresh, trackCursor: rec.trackCursor };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('404')) {
        clearPersistedBroadcast();
        return null;
      }
      // Transient — fall back to the persisted manifest so the user
      // still gets a resume card. The player will surface any real
      // failure on tap.
      console.warn('[BroadcastResumer] manifest verify failed (keeping cached):', msg);
      return { manifest: rec.manifest, trackCursor: rec.trackCursor };
    }
  }

  async decline(): Promise<void> {
    clearPersistedBroadcast();
  }
}
