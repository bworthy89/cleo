import { BroadcastStore } from '@/services/broadcast/BroadcastStore';
import { Db } from '@/services/db/Db';
import type { Manifest } from '@/services/broadcast/types';

describe('Manifest wire format (post-sqlite)', () => {
  it('returns the same shape the client expects', () => {
    const db = new Db(':memory:');
    const store = new BroadcastStore(db);
    const m: Manifest = {
      broadcastId: 'fixed-id-for-snapshot',
      userId: 'u1',
      playlistId: 'p1',
      vibe: 'morning',
      length: 'quick',
      // Use a live timestamp so the TTL check passes; normalize below before snapshotting.
      createdAt: Date.now(),
      tracks: [
        { id: 't0', title: 'Title', artistName: 'Artist', albumTitle: 'Album', duration: 200 },
      ],
      segmentSlots: [
        { index: 0, kind: 'cold_open', beforeTrackId: 't0', variantCount: 3, status: 'pending' },
        { index: 1, kind: 'sign_off', afterTrackId: 't0', variantCount: 1, status: 'pending' },
      ],
    };
    store.put(m);
    const out = store.get('fixed-id-for-snapshot');
    // Normalize the timestamp so the snapshot is deterministic across runs,
    // then snapshot the entire shape — fail loud if any new column leaks into
    // the wire format (e.g. bake_status, abort_requested).
    const normalized = out ? { ...out, createdAt: 1_700_000_000_000 } : out;
    expect(normalized).toMatchInlineSnapshot(`
      {
        "broadcastId": "fixed-id-for-snapshot",
        "createdAt": 1700000000000,
        "length": "quick",
        "playlistId": "p1",
        "segmentSlots": [
          {
            "audioUrls": undefined,
            "beforeTrackId": "t0",
            "index": 0,
            "kind": "cold_open",
            "status": "pending",
            "variantCount": 3,
          },
          {
            "afterTrackId": "t0",
            "audioUrls": undefined,
            "index": 1,
            "kind": "sign_off",
            "status": "pending",
            "variantCount": 1,
          },
        ],
        "tracks": [
          {
            "albumTitle": "Album",
            "artistName": "Artist",
            "duration": 200,
            "id": "t0",
            "title": "Title",
          },
        ],
        "userId": "u1",
        "vibe": "morning",
      }
    `);
    db.close();
  });
});
