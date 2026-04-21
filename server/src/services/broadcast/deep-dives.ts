// server/src/services/broadcast/deep-dives.ts
import type { ManifestTrack } from './types';
import type { EnrichmentLookup } from './SegmentScriptBuilder';
import type { EnrichmentRecord } from '../enrichment/EnrichmentCache';

/**
 * Count how many "rich" enrichment fields are present on a record.
 * Used to rank transitions for deep_dive nomination.
 */
function richnessScore(rec: EnrichmentRecord | null): number {
  if (!rec) return 0;
  let score = 0;
  if (rec.producer) score += 1;
  if (rec.sample) score += 1;
  if (rec.wikipediaSummary) score += 1;
  if (rec.notableFacts?.length) score += 1;
  return score;
}

/**
 * Return slot indices (within the final segmentSlots array) that should be
 * promoted to deep_dive. Ranks transitions by the richness of their
 * *incoming* track's enrichment, caps at ceil((N-1)/4).
 *
 * ManifestBuilder sparse-cadence layout for N tracks:
 *   slot 0            = cold_open (before tracks[0])
 *   slot 1..M         = transitions (before tracks[2], tracks[4], ...)
 *   slot M+1          = sign_off
 * where M = floor((N-1) / 2). Transition at sequence k (0-indexed) sits at
 * segment-slot index k+1 and leads into tracks[(k+1) * 2].
 */
export function nominateDeepDives(
  tracks: ManifestTrack[],
  lookup: EnrichmentLookup,
): number[] {
  if (tracks.length <= 1) return [];
  const N = tracks.length;
  const maxPicks = Math.ceil((N - 1) / 4);

  const candidates: Array<{ slotIndex: number; score: number }> = [];
  let transitionSeq = 0;
  for (let i = 2; i < N; i += 2) {
    const slotIndex = transitionSeq + 1;  // +1 because slot 0 = cold_open
    const rec = lookup.get(tracks[i].title, tracks[i].artistName);
    candidates.push({ slotIndex, score: richnessScore(rec) });
    transitionSeq++;
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates.slice(0, maxPicks)
    .map(c => c.slotIndex)
    .sort((a, b) => a - b);
}
