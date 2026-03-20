import { __resetAllStores } from '../../__mocks__/react-native-mmkv';
import { planQueueLocally } from '../../src/engines/LocalQueuePlanner';
import type { TrackProfile } from '../../src/services/TrackEnrichmentService';
import type { Vibe } from '../../src/cleo/fallbacks';

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function makeTrack(id: string, artist = 'Artist', overrides?: Partial<any>): any {
  return {
    id, title: `Track ${id}`, artistName: artist, albumTitle: 'Album',
    duration: 240, genreNames: ['Pop'], trackNumber: 1, discNumber: 1,
    tags: [], mbEnriched: false, hasRichData: false, ...overrides,
  };
}

const DEFAULT_VIBE: Vibe = 'chill';

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  __resetAllStores();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('planQueueLocally — empty input', () => {
  it('returns empty queue and arcShape short for empty tracks array', () => {
    const result = planQueueLocally([], DEFAULT_VIBE);
    expect(result.queue).toEqual([]);
    expect(result.arcShape).toBe('short');
  });
});

describe('planQueueLocally — single track', () => {
  it('assigns opener role to the only track', () => {
    const tracks: TrackProfile[] = [makeTrack('t1')];
    const result = planQueueLocally(tracks, DEFAULT_VIBE);
    expect(result.queue).toHaveLength(1);
    expect(result.queue[0].trackId).toBe('t1');
    expect(result.queue[0].role).toBe('opener');
  });
});

describe('planQueueLocally — two tracks', () => {
  it('assigns opener to first and closer to second', () => {
    const tracks: TrackProfile[] = [makeTrack('t1'), makeTrack('t2')];
    const result = planQueueLocally(tracks, DEFAULT_VIBE);
    expect(result.queue).toHaveLength(2);

    const roles = result.queue.map(q => q.role);
    expect(roles[0]).toBe('opener');
    expect(roles[1]).toBe('closer');
  });

  it('includes both track IDs', () => {
    const tracks: TrackProfile[] = [makeTrack('t1'), makeTrack('t2')];
    const result = planQueueLocally(tracks, DEFAULT_VIBE);
    const ids = result.queue.map(q => q.trackId).sort();
    expect(ids).toEqual(['t1', 't2'].sort());
  });
});

describe('planQueueLocally — all tracks included', () => {
  it('returns all 10 tracks in output, each ID present exactly once', () => {
    const tracks: TrackProfile[] = Array.from({ length: 10 }, (_, i) =>
      makeTrack(`t${i + 1}`, `Artist${i + 1}`)
    );
    const result = planQueueLocally(tracks, DEFAULT_VIBE);
    expect(result.queue).toHaveLength(10);

    const outputIds = result.queue.map(q => q.trackId).sort();
    const inputIds = tracks.map(t => t.id).sort();
    expect(outputIds).toEqual(inputIds);
  });
});

describe('planQueueLocally — arc shape', () => {
  it('returns short for fewer than 20 tracks', () => {
    const tracks: TrackProfile[] = Array.from({ length: 5 }, (_, i) =>
      makeTrack(`t${i + 1}`)
    );
    expect(planQueueLocally(tracks, DEFAULT_VIBE).arcShape).toBe('short');
  });

  it('returns short for exactly 19 tracks', () => {
    const tracks: TrackProfile[] = Array.from({ length: 19 }, (_, i) =>
      makeTrack(`t${i + 1}`)
    );
    expect(planQueueLocally(tracks, DEFAULT_VIBE).arcShape).toBe('short');
  });

  it('returns medium for exactly 20 tracks', () => {
    const tracks: TrackProfile[] = Array.from({ length: 20 }, (_, i) =>
      makeTrack(`t${i + 1}`)
    );
    expect(planQueueLocally(tracks, DEFAULT_VIBE).arcShape).toBe('medium');
  });

  it('returns medium for exactly 40 tracks', () => {
    const tracks: TrackProfile[] = Array.from({ length: 40 }, (_, i) =>
      makeTrack(`t${i + 1}`)
    );
    expect(planQueueLocally(tracks, DEFAULT_VIBE).arcShape).toBe('medium');
  });

  it('returns long for more than 40 tracks', () => {
    const tracks: TrackProfile[] = Array.from({ length: 41 }, (_, i) =>
      makeTrack(`t${i + 1}`)
    );
    expect(planQueueLocally(tracks, DEFAULT_VIBE).arcShape).toBe('long');
  });

  it('returns long for 50+ tracks', () => {
    const tracks: TrackProfile[] = Array.from({ length: 50 }, (_, i) =>
      makeTrack(`t${i + 1}`)
    );
    expect(planQueueLocally(tracks, DEFAULT_VIBE).arcShape).toBe('long');
  });
});

describe('planQueueLocally — artist separation', () => {
  it('reduces adjacent same-artist tracks compared to worst case (10 mixed-artist tracks)', () => {
    // 5 tracks from ArtistA, 5 from ArtistB — separation algorithm should reduce adjacencies
    const tracks: TrackProfile[] = [
      ...Array.from({ length: 5 }, (_, i) => makeTrack(`a${i}`, 'ArtistA')),
      ...Array.from({ length: 5 }, (_, i) => makeTrack(`b${i}`, 'ArtistB')),
    ];
    const result = planQueueLocally(tracks, DEFAULT_VIBE);

    // Count adjacent same-artist pairs
    let adjacentCount = 0;
    for (let i = 1; i < result.queue.length; i++) {
      const prevArtist = tracks.find(t => t.id === result.queue[i - 1].trackId)!.artistName;
      const currArtist = tracks.find(t => t.id === result.queue[i].trackId)!.artistName;
      if (currArtist === prevArtist) adjacentCount++;
    }
    // Separation is best-effort (single forward pass), allow up to 2 adjacencies
    // Worst case without separation would be ~4, so even 2 shows improvement
    expect(adjacentCount).toBeLessThanOrEqual(2);
  });
});

describe('planQueueLocally — all same artist', () => {
  it('does not crash and returns a valid queue when all tracks share one artist', () => {
    const tracks: TrackProfile[] = Array.from({ length: 8 }, (_, i) =>
      makeTrack(`t${i + 1}`, 'SameArtist')
    );
    let result: ReturnType<typeof planQueueLocally> | undefined;
    expect(() => {
      result = planQueueLocally(tracks, DEFAULT_VIBE);
    }).not.toThrow();

    expect(result).toBeDefined();
    expect(result!.queue).toHaveLength(8);
    // All input IDs are in the output
    const outputIds = result!.queue.map(q => q.trackId).sort();
    const inputIds = tracks.map(t => t.id).sort();
    expect(outputIds).toEqual(inputIds);
  });
});

describe('planQueueLocally — positions are sequential', () => {
  it('positions start at 1 and increment by 1 for each entry', () => {
    const tracks: TrackProfile[] = Array.from({ length: 6 }, (_, i) =>
      makeTrack(`t${i + 1}`, `Artist${i}`)
    );
    const result = planQueueLocally(tracks, DEFAULT_VIBE);
    const positions = result.queue.map(q => q.position);
    expect(positions).toEqual([1, 2, 3, 4, 5, 6]);
  });
});
