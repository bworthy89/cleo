import type { ManifestTrack, Vibe, BroadcastLength } from './types';
import type { EnrichmentCache } from '../enrichment/EnrichmentCache';
import type { FeatureFetchChain, FetchedFeatures } from './FeatureFetchChain';
import type { AudioFeatures } from './audio-features';
import type { ITrackSequencer } from './TrackSequencer';
import { VIBE_CURVES } from './vibe-curves';
import {
  weightedDistance,
  adjacencyPenalty,
  interpolateKeyframes,
} from './scoring';
import { seededPRNG } from './prng';
import { nominateDeepDives } from './deep-dives';

const LENGTH_TO_N: Record<BroadcastLength, number> = {
  quick: 5, standard: 9, long: 15,
};

const K_FOR_LENGTH: Record<BroadcastLength, number> = {
  quick: 2, standard: 3, long: 3,
};

const POOL_CAP = 40;

const POOR_FIT_THRESHOLD = 0.7;

// Types declared locally (not exported as the shared SequenceRequest/SequenceResult)
// so they don't collide with the types exported from TrackSequencer.ts (which still
// carries the 'cache' | 'llm' | 'fallback' source union). TypeScript's structural
// typing ensures this class still satisfies the shared ITrackSequencer interface
// once Task 13 unifies them.
export interface SequenceRequest {
  pool: ManifestTrack[];
  vibe: Vibe;
  length: BroadcastLength;
  userContext: { timeOfDay: string; dayOfWeek: string };
  broadcastId: string;
}

export interface SequenceResult {
  orderedTracks: ManifestTrack[];
  featureSlots: number[];
  source: 'deterministic';
}

interface ScoredTrack {
  track: ManifestTrack;
  features: AudioFeatures;
  score: number;
}

export class DeterministicTrackSequencer implements ITrackSequencer {
  constructor(
    private readonly enrichmentCache: EnrichmentCache,
    private readonly fetchChain: Pick<FeatureFetchChain, 'fetchBatch'>,
  ) {}

  async sequence(req: SequenceRequest): Promise<SequenceResult> {
    const N = LENGTH_TO_N[req.length];
    if (req.pool.length < N) {
      throw new Error(`insufficient tracks: need ${N}, got ${req.pool.length}`);
    }
    const cappedPool = req.pool.slice(0, POOL_CAP);

    // Fetch features for every track in the pool.
    const featureMap = await this.fetchChain.fetchBatch(cappedPool);
    const stats = this.collectStats(featureMap);

    // FeatureFetchChain.fetchBatch is contractually required to return an
    // entry for every input track (tier 5 neutrals is the last-resort). If
    // that invariant breaks, fail loud with the offending track id so the
    // root cause surfaces in a debuggable form rather than as a cryptic
    // `Cannot read property 'features' of undefined`.
    const getFeatures = (t: ManifestTrack): AudioFeatures => {
      const fetched = featureMap.get(t.id);
      if (!fetched) {
        throw new Error(
          `DeterministicTrackSequencer: FeatureFetchChain did not return features for track id=${t.id}. ` +
          `This violates the tier-5 neutrals contract — check FeatureFetchChain.fetchBatch.`,
        );
      }
      return fetched.features;
    };

    const curve = VIBE_CURVES[req.vibe];
    const rng = seededPRNG(req.broadcastId);
    const K = K_FOR_LENGTH[req.length];

    const remaining = cappedPool.map((t): { track: ManifestTrack; features: AudioFeatures } => ({
      track: t,
      features: getFeatures(t),
    }));
    const result: ManifestTrack[] = [];

    for (let i = 0; i < N; i++) {
      const p = N === 1 ? 0 : i / (N - 1);
      const target = interpolateKeyframes(curve.keyframes, p);
      const previous = result[result.length - 1];

      const scored: ScoredTrack[] = remaining.map(({ track, features }) => ({
        track,
        features,
        score: weightedDistance(features, target, curve.weights)
             + adjacencyPenalty(track, previous),
      }));
      scored.sort((a, b) => a.score - b.score);

      const k = Math.min(K, scored.length);
      const topK = scored.slice(0, k);
      const pickedIdx = rng.pickIndex(topK.length);
      const picked = topK[pickedIdx];
      result.push(picked.track);

      const removeIdx = remaining.findIndex(x => x.track.id === picked.track.id);
      if (removeIdx >= 0) remaining.splice(removeIdx, 1);
    }

    // Mean weighted distance of selected tracks (pure vibe fit — no adjacency penalty).
    let totalDistance = 0;
    for (let i = 0; i < result.length; i++) {
      const p = result.length === 1 ? 0 : i / (result.length - 1);
      const target = interpolateKeyframes(curve.keyframes, p);
      const features = getFeatures(result[i]);
      totalDistance += weightedDistance(features, target, curve.weights);
    }
    const meanDistance = totalDistance / result.length;

    if (meanDistance > POOR_FIT_THRESHOLD) {
      console.warn(`[Sequencer] poor vibe fit (mean distance ${meanDistance.toFixed(2)})`);
    }

    const featureSlots = nominateDeepDives(result, this.enrichmentCache);
    this.logResult(req, result, stats, meanDistance);

    return {
      orderedTracks: result,
      featureSlots,
      source: 'deterministic',
    };
  }

  private collectStats(featureMap: Map<string, FetchedFeatures>): {
    reccobeats: number; synthesized: number; defaults: number;
  } {
    let r = 0, s = 0, d = 0;
    for (const f of featureMap.values()) {
      if (f.source === 'reccobeats') r++;
      else if (f.source === 'synthesized') s++;
      else d++;
    }
    return { reccobeats: r, synthesized: s, defaults: d };
  }

  private logResult(
    req: SequenceRequest,
    result: ManifestTrack[],
    stats: { reccobeats: number; synthesized: number; defaults: number },
    meanDistance: number,
  ): void {
    const firstId = result[0]?.id ?? '';
    const lastId = result[result.length - 1]?.id ?? '';
    console.log(
      `[Sequencer] source=deterministic vibe=${req.vibe} N=${result.length} poolSize=${req.pool.length} ` +
      `firstId=${firstId} lastId=${lastId} meanDistance=${meanDistance.toFixed(2)} ` +
      `features: reccobeats=${stats.reccobeats} synthesized=${stats.synthesized} defaults=${stats.defaults}`
    );
  }
}
