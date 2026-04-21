import { synthesizeFeatures } from './feature-synth';
import type { AudioFeatures } from './audio-features';
import { NEUTRAL_FEATURES } from './audio-features';
import type { ManifestTrack } from './types';
import type { ReccoBeatsFetcher } from '../enrichment/fetchers/ReccoBeatsFetcher';
import type { DeezerFeaturesFetcher } from '../enrichment/fetchers/DeezerFeaturesFetcher';
import { normalizeGenreFamily } from './GenreFamily';

export interface LastFmTagLookup {
  get(title: string, artist: string): Promise<string[]>;
}

export type FeatureSource = 'reccobeats' | 'synthesized' | 'defaults';

export interface FetchedFeatures {
  features: AudioFeatures;
  source: FeatureSource;
  partial: boolean;  // true if ReccoBeats returned partial data filled via synth
}

interface Deps {
  recco: Pick<ReccoBeatsFetcher, 'fetch'>;
  deezer: Pick<DeezerFeaturesFetcher, 'fetch'>;
  lastFmTags: LastFmTagLookup;
}

export class FeatureFetchChain {
  constructor(private deps: Deps) {}

  /** Fetch features for a single track, trying each tier in order. Each
   *  external dep call is wrapped so an unexpected throw falls cleanly to
   *  the next tier instead of aborting the whole chain. */
  async fetchOne(track: ManifestTrack): Promise<FetchedFeatures> {
    // Tier 1: ReccoBeats (ISRC only)
    if (track.isrc) {
      try {
        const hit = await this.deps.recco.fetch([track.isrc]);
        const f = hit.get(track.isrc);
        if (f) return { features: f, source: 'reccobeats', partial: false };
      } catch (err) {
        console.warn(`[FeatureFetchChain] tier-1 recco threw for ${track.isrc}: ${err}`);
      }
    }

    // Tier 2: Deezer partial (ISRC only) + synth
    if (track.isrc) {
      let deezer: Awaited<ReturnType<DeezerFeaturesFetcher['fetch']>> = null;
      try {
        deezer = await this.deps.deezer.fetch(track.isrc);
      } catch (err) {
        console.warn(`[FeatureFetchChain] tier-2 deezer threw for ${track.isrc}: ${err}`);
      }
      if (deezer) {
        const tags = await this.safeLastFmTags(track);
        const features = synthesizeFeatures({
          partialFeatures: deezer,
          lastFmTags: tags,
          genreFamily: normalizeGenreFamily(track.genreNames),
        });
        return { features, source: 'synthesized', partial: false };
      }
    }

    // Tier 3: Last.fm + genre synth
    const tags = await this.safeLastFmTags(track);
    if (tags.length > 0) {
      const features = synthesizeFeatures({
        lastFmTags: tags,
        genreFamily: normalizeGenreFamily(track.genreNames),
      });
      return { features, source: 'synthesized', partial: false };
    }

    // Tier 4: genre-only
    const family = normalizeGenreFamily(track.genreNames);
    if (family !== 'generic') {
      const features = synthesizeFeatures({ genreFamily: family });
      return { features, source: 'synthesized', partial: false };
    }

    // Tier 5: neutrals
    return { features: { ...NEUTRAL_FEATURES }, source: 'defaults', partial: false };
  }

  /** Wrap `lastFmTags.get` so a throw falls through to an empty tag list
   *  (natural no-op for downstream synth) instead of aborting the tier. */
  private async safeLastFmTags(track: ManifestTrack): Promise<string[]> {
    try {
      return await this.deps.lastFmTags.get(track.title, track.artistName);
    } catch (err) {
      console.warn(`[FeatureFetchChain] lastFmTags threw for "${track.title}" by ${track.artistName}: ${err}`);
      return [];
    }
  }

  /** Batch version — groups ISRCs for ReccoBeats to cut HTTP overhead. */
  async fetchBatch(tracks: ManifestTrack[]): Promise<Map<string, FetchedFeatures>> {
    const withIsrc = tracks.filter(t => !!t.isrc);
    let reccoHits: Map<string, AudioFeatures> = new Map();
    if (withIsrc.length > 0) {
      try {
        reccoHits = await this.deps.recco.fetch(withIsrc.map(t => t.isrc!));
      } catch (err) {
        console.warn(`[FeatureFetchChain] batch recco threw for ${withIsrc.length} tracks: ${err}`);
      }
    }
    const result = new Map<string, FetchedFeatures>();
    for (const t of tracks) {
      if (t.isrc && reccoHits.has(t.isrc)) {
        result.set(t.id, {
          features: reccoHits.get(t.isrc)!,
          source: 'reccobeats',
          partial: false,
        });
        continue;
      }
      // Fall back per-track for the remaining tiers
      result.set(t.id, await this.fetchOne(t));
    }
    return result;
  }
}
