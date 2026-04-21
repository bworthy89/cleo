import type { AudioFeatures } from './audio-features';
import { NEUTRAL_FEATURES } from './audio-features';
import type { GenreFamily } from './GenreFamily';

/**
 * Partial ReccoBeats / Deezer response shape. Anything that arrives complete
 * bypasses synthesis; anything missing gets filled from the other sources.
 */
export interface SynthInput {
  partialFeatures?: Partial<AudioFeatures>;
  genreFamily?: GenreFamily;
  lastFmTags?: string[];
}

/**
 * Per-genre default feature vectors, keyed on the canonical
 * {@link GenreFamily} enum values produced by `normalizeGenreFamily`. Callers
 * must pass a normalized value — raw Last.fm / MusicBrainz strings like
 * `'ambient'`, `'soul'`, or `'classical'` will not match and will silently
 * fall through to neutrals. Route those through `normalizeGenreFamily` first.
 *
 * Sub-genres subsumed by normalization:
 *   - `ambient` → `electronic` (we use club-shaped electronic defaults)
 *   - `soul` / `funk` / `disco` / `blues` → `rnb`
 *   - `country` / `bluegrass` / `americana` → `folk`
 *   - `latin` / `reggae` / `afrobeats` → `global`
 *   - `classical` → `generic` (no regex match in normalizeGenreFamily)
 */
const GENRE_DEFAULTS: Partial<Record<GenreFamily, Partial<AudioFeatures>>> = {
  electronic: { tempo: 120, energy: 0.65, valence: 0.60, danceability: 0.70, acousticness: 0.15, loudness: 0.65, instrumentalness: 0.30 },
  rock:       { tempo: 120, energy: 0.75, valence: 0.60, danceability: 0.55, acousticness: 0.15, loudness: 0.75, instrumentalness: 0.05 },
  pop:        { tempo: 110, energy: 0.65, valence: 0.70, danceability: 0.70, acousticness: 0.20, loudness: 0.65, instrumentalness: 0.05 },
  hipHop:     { tempo: 90,  energy: 0.65, valence: 0.55, danceability: 0.75, acousticness: 0.12, loudness: 0.70, instrumentalness: 0.03 },
  rnb:        { tempo: 95,  energy: 0.55, valence: 0.60, danceability: 0.65, acousticness: 0.27, loudness: 0.55, instrumentalness: 0.05 },
  jazz:       { tempo: 100, energy: 0.45, valence: 0.55, danceability: 0.45, acousticness: 0.60, loudness: 0.40, instrumentalness: 0.40 },
  folk:       { tempo: 105, energy: 0.50, valence: 0.60, danceability: 0.45, acousticness: 0.55, loudness: 0.45, instrumentalness: 0.10 },
  global:     { tempo: 115, energy: 0.72, valence: 0.72, danceability: 0.78, acousticness: 0.22, loudness: 0.62, instrumentalness: 0.05 },
  gospel:     { tempo: 95,  energy: 0.60, valence: 0.75, danceability: 0.55, acousticness: 0.35, loudness: 0.55, instrumentalness: 0.05 },
  generic:    {},
};

interface TagEffect {
  energy?: number;
  valence?: number;
  danceability?: number;
  acousticness?: number;
}

const TAG_TABLE: Record<string, TagEffect> = {
  chill:         { energy: 0.30, valence: 0.45 },
  mellow:        { energy: 0.35, valence: 0.50 },
  energetic:     { energy: 0.80 },
  upbeat:        { energy: 0.70, valence: 0.80 },
  happy:         { valence: 0.80 },
  melancholy:    { energy: 0.35, valence: 0.20 },
  sad:           { energy: 0.30, valence: 0.15 },
  intense:       { energy: 0.85 },
  aggressive:    { energy: 0.85, valence: 0.35 },
  romantic:      { energy: 0.40, valence: 0.65, acousticness: 0.55 },
  dreamy:        { energy: 0.30, valence: 0.55, acousticness: 0.60 },
  groovy:        { danceability: 0.80, energy: 0.65 },
  danceable:     { danceability: 0.85 },
  acoustic:      { acousticness: 0.80, energy: 0.35 },
  ambient:       { energy: 0.25, acousticness: 0.70 },
};

/**
 * Merge tag-based feature adjustments into a base vector. Overlapping
 * tags average their effects on the same field.
 */
export function applyTagOverrides(
  base: AudioFeatures, tags: string[],
): AudioFeatures {
  const accum: Partial<Record<keyof AudioFeatures, number[]>> = {};
  for (const raw of tags) {
    const tag = raw.toLowerCase();
    const effect = TAG_TABLE[tag];
    if (!effect) continue;
    for (const key of Object.keys(effect) as (keyof TagEffect)[]) {
      const v = effect[key];
      if (v === undefined) continue;
      if (!accum[key]) accum[key] = [];
      accum[key]!.push(v);
    }
  }
  const result = { ...base };
  for (const key of Object.keys(accum) as (keyof AudioFeatures)[]) {
    const values = accum[key];
    if (!values || values.length === 0) continue;
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    (result as Record<string, number>)[key] = avg;
  }
  return result;
}

/**
 * Produce a complete AudioFeatures vector from whatever signals are
 * available. Priority (most→least trusted): partialFeatures → tags → genre → neutrals.
 */
export function synthesizeFeatures(input: SynthInput): AudioFeatures {
  const genreBase: Partial<AudioFeatures> = input.genreFamily
    ? (GENRE_DEFAULTS[input.genreFamily] ?? {})
    : {};
  const base: AudioFeatures = {
    ...NEUTRAL_FEATURES,
    ...genreBase,
  };
  const withTags = input.lastFmTags?.length
    ? applyTagOverrides(base, input.lastFmTags)
    : base;
  const withPartial: AudioFeatures = {
    ...withTags,
    ...(input.partialFeatures ?? {}),
  };
  return withPartial;
}
