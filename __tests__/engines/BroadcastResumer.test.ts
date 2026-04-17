import { BroadcastResumer } from '../../src/engines/BroadcastResumer';
import * as Storage from '../../src/services/Storage';
import type { Manifest } from '../../src/engines/BroadcastPlayer.types';

jest.mock('../../src/services/Storage');

describe('BroadcastResumer', () => {
  const base: Manifest = {
    broadcastId: 'b1', userId: 'u1', playlistId: 'p1',
    vibe: 'morning', length: 'quick', createdAt: Date.now(),
    tracks: [], segmentSlots: [],
  };

  beforeEach(() => jest.resetAllMocks());

  it('returns null when nothing is persisted', async () => {
    (Storage.getPersistedBroadcast as jest.Mock).mockReturnValue(undefined);
    const resumer = new BroadcastResumer();
    expect(await resumer.check()).toBeNull();
  });

  it('returns null and clears storage when persisted is older than 2h', async () => {
    (Storage.getPersistedBroadcast as jest.Mock).mockReturnValue({
      ...base, createdAt: Date.now() - (2 * 60 * 60 * 1000 + 1000),
    });
    const resumer = new BroadcastResumer();
    expect(await resumer.check()).toBeNull();
    expect(Storage.clearPersistedBroadcast).toHaveBeenCalled();
  });

  it('returns the manifest when persisted within 2h', async () => {
    const fresh = { ...base, createdAt: Date.now() - 60 * 1000 };
    (Storage.getPersistedBroadcast as jest.Mock).mockReturnValue(fresh);
    const resumer = new BroadcastResumer();
    expect((await resumer.check())?.broadcastId).toBe('b1');
  });

  it('decline() clears persisted state', async () => {
    const resumer = new BroadcastResumer();
    await resumer.decline();
    expect(Storage.clearPersistedBroadcast).toHaveBeenCalled();
  });
});
