import { BroadcastResumer } from '../../src/engines/BroadcastResumer';
import * as Storage from '../../src/services/Storage';
import type { Manifest } from '../../src/engines/BroadcastPlayer.types';
import type { PersistedBroadcast } from '../../src/services/Storage';

jest.mock('../../src/services/Storage');
// Stub BroadcastManifestClient so importing BroadcastResumer doesn't
// transitively pull in Firebase (not worth transforming for unit tests).
jest.mock('../../src/engines/BroadcastManifestClient', () => ({
  BroadcastManifestClient: jest.fn().mockImplementation(() => ({
    fetchManifest: jest.fn().mockResolvedValue(null),
  })),
}));

const ok = (m: Manifest) => ({ fetchManifest: jest.fn().mockResolvedValue(m) });
const notFound = () => ({ fetchManifest: jest.fn().mockRejectedValue(new Error('fetchManifest failed: 404 ')) });
const flaky = () => ({ fetchManifest: jest.fn().mockRejectedValue(new Error('Network request failed')) });

const baseManifest: Manifest = {
  broadcastId: 'b1', userId: 'u1', playlistId: 'p1',
  vibe: 'morning', length: 'quick', createdAt: Date.now(),
  tracks: [], segmentSlots: [],
};

const rec = (overrides: Partial<PersistedBroadcast> = {}): PersistedBroadcast => ({
  manifest: baseManifest,
  trackCursor: 2,
  updatedAt: Date.now(),
  ...overrides,
});

describe('BroadcastResumer', () => {
  beforeEach(() => jest.resetAllMocks());

  it('returns null when nothing is persisted', async () => {
    (Storage.getPersistedBroadcast as jest.Mock).mockReturnValue(undefined);
    const resumer = new BroadcastResumer(ok(baseManifest));
    expect(await resumer.check()).toBeNull();
  });

  it('returns null and clears storage when persisted is older than 24h', async () => {
    (Storage.getPersistedBroadcast as jest.Mock).mockReturnValue(
      rec({ manifest: { ...baseManifest, createdAt: Date.now() - (24 * 60 * 60 * 1000 + 1000) } }),
    );
    const resumer = new BroadcastResumer(ok(baseManifest));
    expect(await resumer.check()).toBeNull();
    expect(Storage.clearPersistedBroadcast).toHaveBeenCalled();
  });

  it('returns { fresh manifest, cursor } when persisted is fresh and server still has it', async () => {
    const fresh = { ...baseManifest, createdAt: Date.now() - 60 * 1000 };
    (Storage.getPersistedBroadcast as jest.Mock).mockReturnValue(rec({ manifest: fresh, trackCursor: 3 }));
    const resumer = new BroadcastResumer(ok(fresh));
    const result = await resumer.check();
    expect(result?.manifest.broadcastId).toBe('b1');
    expect(result?.trackCursor).toBe(3);
  });

  it('uses the server-fetched manifest, not the persisted one (slot updates)', async () => {
    const persisted: Manifest = {
      ...baseManifest, createdAt: Date.now() - 60 * 1000,
      segmentSlots: [
        { index: 0, kind: 'cold_open', beforeTrackId: 't0', variantCount: 1, status: 'pending' },
      ],
    };
    const fresh: Manifest = {
      ...persisted,
      segmentSlots: [
        { index: 0, kind: 'cold_open', beforeTrackId: 't0', variantCount: 1, status: 'ready', audioUrls: ['u'] },
      ],
    };
    (Storage.getPersistedBroadcast as jest.Mock).mockReturnValue(rec({ manifest: persisted }));
    const resumer = new BroadcastResumer(ok(fresh));
    const result = await resumer.check();
    expect(result?.manifest.segmentSlots[0].status).toBe('ready');
  });

  it('clears persisted + returns null when server returns 404', async () => {
    (Storage.getPersistedBroadcast as jest.Mock).mockReturnValue(
      rec({ manifest: { ...baseManifest, createdAt: Date.now() - 60 * 1000 } }),
    );
    const resumer = new BroadcastResumer(notFound());
    expect(await resumer.check()).toBeNull();
    expect(Storage.clearPersistedBroadcast).toHaveBeenCalled();
  });

  it('falls back to persisted manifest when server fetch fails for non-404 reasons', async () => {
    const persisted = { ...baseManifest, createdAt: Date.now() - 60 * 1000 };
    (Storage.getPersistedBroadcast as jest.Mock).mockReturnValue(rec({ manifest: persisted, trackCursor: 4 }));
    const resumer = new BroadcastResumer(flaky());
    const result = await resumer.check();
    expect(result?.manifest.broadcastId).toBe('b1');
    expect(result?.trackCursor).toBe(4);
    expect(Storage.clearPersistedBroadcast).not.toHaveBeenCalled();
  });

  it('decline() clears persisted state', async () => {
    const resumer = new BroadcastResumer(ok(baseManifest));
    await resumer.decline();
    expect(Storage.clearPersistedBroadcast).toHaveBeenCalled();
  });
});
