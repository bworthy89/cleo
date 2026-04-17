import type { ManifestTrack } from './types';

const MAX_PASSES = 5;

export interface RepairInput {
  ordered: ManifestTrack[];
  pool: ManifestTrack[];
}

export interface RepairResult {
  ordered: ManifestTrack[];
  repairCount: number;
  passes: number;
}

/**
 * Replace duplicate track IDs with unused tracks from the pool.
 * Walks the ordered list; on first duplicate sighting, picks the next
 * pool track not already present. If pool is exhausted, accepts the dup.
 */
export function removeDuplicates(
  ordered: ManifestTrack[],
  pool: ManifestTrack[],
): ManifestTrack[] {
  const seen = new Set<string>();
  const result: ManifestTrack[] = [];
  const used = new Set<string>();
  for (const t of ordered) {
    if (!seen.has(t.id)) {
      seen.add(t.id);
      used.add(t.id);
      result.push(t);
      continue;
    }
    const replacement = pool.find(p => !used.has(p.id));
    if (replacement) {
      used.add(replacement.id);
      seen.add(replacement.id);
      result.push(replacement);
    } else {
      result.push(t); // accept duplicate; pool exhausted
    }
  }
  return result;
}

function firstViolationIndex(ordered: ManifestTrack[]): number {
  for (let i = 1; i < ordered.length; i++) {
    if (ordered[i].artistName === ordered[i - 1].artistName) return i;
    if (ordered[i].albumTitle === ordered[i - 1].albumTitle) return i;
  }
  return -1;
}

function tryResolveAt(
  ordered: ManifestTrack[],
  idx: number,
): ManifestTrack[] | null {
  // Look forward for a track that, if swapped in at idx, removes the violation
  for (let j = idx + 1; j < ordered.length; j++) {
    const a = ordered[j];
    const prev = ordered[idx - 1];
    const next = ordered[idx + 1];
    const viol1 = a.artistName === prev.artistName || a.albumTitle === prev.albumTitle;
    const viol2 = next
      ? a.artistName === next.artistName || a.albumTitle === next.albumTitle
      : false;
    if (viol1 || viol2) continue;
    // Check that moving ordered[idx] into j's position doesn't create violation there
    const moving = ordered[idx];
    const jPrev = j - 1 === idx ? a : ordered[j - 1]; // after swap, j-1 is what was at j-1
    const jNext = ordered[j + 1];
    const violAtJ1 = moving.artistName === jPrev.artistName || moving.albumTitle === jPrev.albumTitle;
    const violAtJ2 = jNext
      ? moving.artistName === jNext.artistName || moving.albumTitle === jNext.albumTitle
      : false;
    if (violAtJ1 || violAtJ2) continue;
    const next_ = [...ordered];
    [next_[idx], next_[j]] = [next_[j], next_[idx]];
    return next_;
  }
  return null;
}

/**
 * Iteratively repairs same-artist and same-album adjacency violations by
 * swapping positions. Up to MAX_PASSES iterations. Accepts whatever's left
 * if unrepairable (does not throw).
 */
export function repairSequence(input: RepairInput): RepairResult {
  let current = [...input.ordered];
  let repairCount = 0;
  let passes = 0;
  for (; passes < MAX_PASSES; passes++) {
    const idx = firstViolationIndex(current);
    if (idx === -1) break;
    const next = tryResolveAt(current, idx);
    if (!next) break; // unresolvable — accept and exit
    current = next;
    repairCount++;
  }
  return { ordered: current, repairCount, passes };
}
