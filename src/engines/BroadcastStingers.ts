import type { Vibe } from './BroadcastPlayer.types';

export type StingerKind = 'in' | 'out';

// Stingers are bundled MP3s that punctuate transitions (e.g., a brief swoosh
// into a segment or out of one). MVP ships without real assets; getStinger
// returns null and BroadcastPlayer treats that as "skip the stinger, play
// the segment directly." Replace with real sound design later.
export async function getStinger(_vibe: Vibe, _kind: StingerKind): Promise<string | null> {
  return null;
}

export async function preloadStingers(): Promise<void> {
  // Nothing to preload while stingers are stubbed.
}
