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

  /** Fetch features for a single track, trying each tier in order. */
  async fetchOne(track: ManifestTrack): Promise<FetchedFeatures> {
    // Tier 1: ReccoBeats (ISRC only)
    if (track.isrc) {
      const hit = await this.deps.recco.fetch([track.isrc]);
      const f = hit.get(track.isrc);
      if (f) return { features: f, source: 'reccobeats', partial: false };
    }

    // Tier 2: Deezer partial (ISRC only) + synth
    if (track.isrc) {
      const deezer = await this.deps.deezer.fetch(track.isrc);
      if (deezer) {
        const tags = await this.deps.lastFmTags.get(track.title, track.artistName);
        const features = synthesizeFeatures({
          partialFeatures: deezer,
          lastFmTags: tags,
          genreFamily: normalizeGenreFamily(track.genreNames),
        });
        return { features, source: 'synthesized', partial: false };
      }
    }

    // Tier 3: Last.fm + genre synth
    const tags = await this.deps.lastFmTags.get(track.title, track.artistName);
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

  /** Batch version — groups ISRCs for ReccoBeats to cut HTTP overhead. */
  async fetchBatch(tracks: ManifestTrack[]): Promise<Map<string, FetchedFeatures>> {
    const withIsrc = tracks.filter(t => !!t.isrc);
    const reccoHits = withIsrc.length > 0
      ? await this.deps.recco.fetch(withIsrc.map(t => t.isrc!))
      : new Map<string, AudioFeatures>();
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
