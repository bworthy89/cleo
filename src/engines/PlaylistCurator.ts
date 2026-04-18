import { authenticatedFetch } from '../services/api';
import { searchCatalog, CatalogSearchResult } from '../../modules/expo-music-kit';
import { TrackProfile } from '../services/TrackEnrichmentService';
import type { Vibe } from '../engines/BroadcastPlayer.types';

export interface CurationRequest {
  prompt: string;
  trackCount?: number;
}

export interface RefinementRequest {
  userFeedback: string;
  existingTracks: { title: string; artist: string }[];
}

interface LLMTrackSuggestion {
  title: string;
  artist: string;
}

interface CurationResponse {
  tracks: LLMTrackSuggestion[];
  suggestedVibe: Vibe;
  playlistTitle: string;
  playlistDescription: string;
  conversationalResponse: string;
}

// ─────────────────────── Intent classifier ───────────────────────────

type Intent =
  | 'single-artist'
  | 'artist-circle'
  | 'scene'
  | 'mood'
  | 'era-genre'
  | 'specific-track'
  | 'seed-track-plus'
  | 'deep-cuts'
  | 'mixed';

interface IntentResponse {
  intent: Intent;
  artists: string[];
  seedTracks: { title: string; artist: string }[];
  vibe: Vibe | null;
  era: string | null;
  genre: string | null;
  stance: string;
  playlistTitle: string;
  conversationalResponse: string;
  options: string[];
}

export interface CuratedPlaylist {
  tracks: TrackProfile[];
  trackIds: string[];
  suggestedVibe: Vibe;
  playlistTitle: string;
  playlistDescription: string;
  conversationalResponse: string;
  /** ONAY's curatorial stance — 2-3 sentences explaining the arc choice. */
  stance?: string;
  /** Tappable steering options — "wider", "tighter", "different vibe". */
  options?: string[];
  /** Classified intent, exposed for UX + future surgical refinement. */
  intent?: Intent;
}

const SEARCH_BATCH_SIZE = 5;
const GAP_FILL_THRESHOLD = 0.2; // 20% unmatched triggers gap-fill
const SEARCH_TIMEOUT_MS = 45000;
const TARGET_TRACK_COUNT = 15;
// Apple Music catalog search API caps `limit` at 25; exceeding it throws
// MusicDataRequest.Error code 1. Clamp every searchCatalog call.
const MAX_CATALOG_SEARCH_LIMIT = 25;

async function callCurateEndpoint(body: Record<string, unknown>): Promise<CurationResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);

  try {
    const response = await authenticatedFetch('/curate-playlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Curation failed: ${response.status}`);
    }

    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function classifyIntent(prompt: string): Promise<IntentResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);
  try {
    const response = await authenticatedFetch('/curate-intent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Intent classification failed: ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

// ─────────────────────── Matching helpers ────────────────────────────

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function fuzzyMatch(a: string, b: string): boolean {
  const na = normalize(a);
  const nb = normalize(b);
  return na.includes(nb) || nb.includes(na);
}

function findBestMatch(
  suggestion: LLMTrackSuggestion,
  results: CatalogSearchResult[]
): CatalogSearchResult | null {
  // Title + artist must both fuzzy-match. No title-only fallback — it used
  // to return, e.g., Amy Winehouse's "Rehab" when asked for Brent Faiyaz's
  // "Rehab", exactly the unrelated-artist drift we're trying to avoid.
  for (const result of results) {
    if (
      fuzzyMatch(result.title, suggestion.title) &&
      fuzzyMatch(result.artistName, suggestion.artist)
    ) {
      return result;
    }
  }
  return null;
}

function catalogResultToTrackProfile(result: CatalogSearchResult): TrackProfile {
  return {
    id: result.id,
    title: result.title,
    artistName: result.artistName,
    albumTitle: result.albumTitle,
    duration: result.duration,
    genreNames: result.genreNames,
    artworkUrl: result.artworkUrl,
    trackNumber: 0,
    discNumber: 0,
    mbEnriched: false,
    hasRichData: false,
    tags: result.genreNames,
  };
}

function dedupeById(profiles: TrackProfile[]): TrackProfile[] {
  const seen = new Set<string>();
  const out: TrackProfile[] = [];
  for (const p of profiles) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    out.push(p);
  }
  return out;
}

/** Spread same-artist tracks so two in a row is a last resort. */
function avoidAdjacentSameArtist(profiles: TrackProfile[]): TrackProfile[] {
  if (profiles.length < 2) return profiles;
  const result: TrackProfile[] = [];
  const pool = [...profiles];
  let lastArtist = '';
  while (pool.length > 0) {
    const idx = pool.findIndex(p => p.artistName !== lastArtist);
    const chosen = idx >= 0 ? pool.splice(idx, 1)[0] : pool.shift()!;
    result.push(chosen);
    lastArtist = chosen.artistName;
  }
  return result;
}

// ─────────────────────── Strategies ──────────────────────────────────

/**
 * single-artist: fetch the named artist's top tracks from Apple Music
 * catalog directly. No LLM generates tracks; all results are guaranteed
 * by that artist (filtered by fuzzy artist-name match against the catalog).
 */
async function strategySingleArtist(artistName: string, count: number): Promise<TrackProfile[]> {
  const limit = Math.min(count * 3, MAX_CATALOG_SEARCH_LIMIT);
  const results = await searchCatalog(artistName, ['songs'], limit);
  const byArtist = results.filter(r => fuzzyMatch(r.artistName, artistName));
  return byArtist.slice(0, count).map(catalogResultToTrackProfile);
}

/**
 * scene / artist-circle: for each artist the classifier named, fetch
 * their top few songs, merge, dedupe, spread to avoid adjacent same-
 * artist runs. Pure catalog — no LLM track recall.
 */
async function strategyArtistBundle(
  artists: string[], count: number,
): Promise<TrackProfile[]> {
  if (artists.length === 0) return [];
  const perArtist = Math.max(2, Math.ceil(count / Math.max(artists.length, 1)) + 1);
  const batches = await Promise.all(
    artists.map(async (name) => {
      try {
        const limit = Math.min(perArtist * 2, MAX_CATALOG_SEARCH_LIMIT);
        const results = await searchCatalog(name, ['songs'], limit);
        return results
          .filter(r => fuzzyMatch(r.artistName, name))
          .slice(0, perArtist)
          .map(catalogResultToTrackProfile);
      } catch {
        return [] as TrackProfile[];
      }
    }),
  );
  const interleaved: TrackProfile[] = [];
  const maxLen = Math.max(0, ...batches.map(b => b.length));
  for (let i = 0; i < maxLen; i++) {
    for (const batch of batches) {
      if (batch[i]) interleaved.push(batch[i]);
    }
  }
  return avoidAdjacentSameArtist(dedupeById(interleaved)).slice(0, count);
}

/**
 * specific-track / seed-track-plus: resolve each named seed via title+
 * artist catalog search. For seed-track-plus we'd expand into a scene
 * run — for now we just return the seed(s) and let the caller top up.
 */
async function strategySeedTracks(
  seeds: { title: string; artist: string }[], count: number,
): Promise<TrackProfile[]> {
  const matches: TrackProfile[] = [];
  for (const seed of seeds) {
    try {
      const results = await searchCatalog(`${seed.title} ${seed.artist}`, ['songs'], 5);
      const match = findBestMatch(seed, results);
      if (match) matches.push(catalogResultToTrackProfile(match));
    } catch { /* swallow, move on */ }
  }
  return dedupeById(matches).slice(0, count);
}

// ─────────────────────── Legacy LLM-suggest path ─────────────────────

async function searchBatch(
  suggestions: LLMTrackSuggestion[]
): Promise<{ matched: Map<number, CatalogSearchResult>; unmatched: number[] }> {
  const matched = new Map<number, CatalogSearchResult>();
  const unmatched: number[] = [];

  for (let i = 0; i < suggestions.length; i += SEARCH_BATCH_SIZE) {
    const batch = suggestions.slice(i, i + SEARCH_BATCH_SIZE);
    const promises = batch.map(async (suggestion, batchIdx) => {
      const globalIdx = i + batchIdx;
      try {
        const query = `${suggestion.title} ${suggestion.artist}`;
        const results = await searchCatalog(query, ['songs'], 5);
        const match = findBestMatch(suggestion, results);
        if (match) {
          matched.set(globalIdx, match);
        } else {
          unmatched.push(globalIdx);
        }
      } catch {
        unmatched.push(globalIdx);
      }
    });
    await Promise.all(promises);
  }

  return { matched, unmatched };
}

/**
 * Fallback path: ask the LLM to suggest tracks (title + artist) and
 * resolve via catalog with gap-fill retry. Used when the intent doesn't
 * have a catalog-grounded strategy (mood, era-genre, deep-cuts, mixed).
 */
async function legacyLlmCuration(prompt: string, count: number): Promise<{
  tracks: TrackProfile[];
  suggestedVibe: Vibe;
  playlistTitle: string;
  playlistDescription: string;
  conversationalResponse: string;
}> {
  const llmResponse = await callCurateEndpoint({ prompt, trackCount: count, round: 'initial' });
  const { matched, unmatched } = await searchBatch(llmResponse.tracks);

  let finalMatched = matched;
  if (unmatched.length / llmResponse.tracks.length > GAP_FILL_THRESHOLD) {
    const unmatchedSuggestions = unmatched.map(i => llmResponse.tracks[i]);
    const matchedSuggestions = Array.from(matched.entries()).map(([i]) => llmResponse.tracks[i]);
    try {
      const gapFill = await callCurateEndpoint({
        prompt, trackCount: unmatched.length, round: 'gap-fill',
        existingTracks: matchedSuggestions, unmatchedTracks: unmatchedSuggestions,
      });
      const { matched: gapMatched } = await searchBatch(gapFill.tracks);
      let nextIdx = llmResponse.tracks.length;
      for (const [, result] of gapMatched) {
        finalMatched.set(nextIdx++, result);
      }
    } catch { /* gap-fill is best-effort */ }
  }

  const orderedIndexes = Array.from(finalMatched.keys()).sort((a, b) => a - b);
  const tracks = orderedIndexes.map(idx => catalogResultToTrackProfile(finalMatched.get(idx)!));
  return {
    tracks,
    suggestedVibe: llmResponse.suggestedVibe,
    playlistTitle: llmResponse.playlistTitle,
    playlistDescription: llmResponse.playlistDescription,
    conversationalResponse: llmResponse.conversationalResponse,
  };
}

// ─────────────────────── Orchestrator ────────────────────────────────

export async function curatePlaylist(
  request: CurationRequest
): Promise<CuratedPlaylist> {
  const count = request.trackCount ?? TARGET_TRACK_COUNT;

  // Step 1: classify intent + get stance/options/title from the LLM in
  // one call. This replaces the previous "LLM suggests 20 tracks"
  // opening move with "LLM tells us what the listener meant."
  const intent = await classifyIntent(request.prompt);

  // Step 2: route to an intent-specific strategy.
  let tracks: TrackProfile[] = [];

  if (intent.intent === 'single-artist' && intent.artists[0]) {
    tracks = await strategySingleArtist(intent.artists[0], count);
  } else if (
    (intent.intent === 'scene' || intent.intent === 'artist-circle') &&
    intent.artists.length > 0
  ) {
    tracks = await strategyArtistBundle(intent.artists, count);
  } else if (
    (intent.intent === 'specific-track' || intent.intent === 'seed-track-plus') &&
    intent.seedTracks.length > 0
  ) {
    tracks = await strategySeedTracks(intent.seedTracks, count);
    if (intent.intent === 'seed-track-plus' && tracks.length < count) {
      // Expand around the seed's artist.
      const seedArtists = Array.from(new Set(intent.seedTracks.map(s => s.artist)));
      const adjacent = await strategyArtistBundle(seedArtists, count - tracks.length);
      tracks = dedupeById([...tracks, ...adjacent]);
    }
  }

  // Fallback: either the strategy returned too few or the intent doesn't
  // have a catalog-grounded strategy (mood / era-genre / deep-cuts / mixed).
  if (tracks.length < 5) {
    const legacy = await legacyLlmCuration(request.prompt, count);
    const legacyPlaylist: CuratedPlaylist = {
      tracks: legacy.tracks,
      trackIds: legacy.tracks.map(t => t.id),
      suggestedVibe: intent.vibe ?? legacy.suggestedVibe,
      playlistTitle: intent.playlistTitle || legacy.playlistTitle,
      playlistDescription: legacy.playlistDescription,
      conversationalResponse: intent.conversationalResponse || legacy.conversationalResponse,
      stance: intent.stance,
      options: intent.options,
      intent: intent.intent,
    };
    if (legacyPlaylist.tracks.length < 5) {
      throw new Error('Too few tracks matched. Try a different prompt.');
    }
    return legacyPlaylist;
  }

  return {
    tracks,
    trackIds: tracks.map(t => t.id),
    suggestedVibe: intent.vibe ?? 'feelGood',
    playlistTitle: intent.playlistTitle,
    playlistDescription: intent.stance,
    conversationalResponse: intent.conversationalResponse,
    stance: intent.stance,
    options: intent.options,
    intent: intent.intent,
  };
}

export async function refinePlaylist(
  request: RefinementRequest,
  originalPrompt: string,
  currentVibe: Vibe
): Promise<CuratedPlaylist> {
  const llmResponse = await callCurateEndpoint({
    prompt: originalPrompt,
    trackCount: request.existingTracks.length,
    round: 'refinement',
    existingTracks: request.existingTracks,
    userFeedback: request.userFeedback,
  });

  const { matched } = await searchBatch(llmResponse.tracks);
  const orderedIndexes = Array.from(matched.keys()).sort((a, b) => a - b);
  const trackProfiles = orderedIndexes
    .map(idx => matched.get(idx)!)
    .map(catalogResultToTrackProfile);

  if (trackProfiles.length < 5) {
    throw new Error('Too few tracks matched after refinement.');
  }

  return {
    tracks: trackProfiles,
    trackIds: trackProfiles.map(t => t.id),
    suggestedVibe: llmResponse.suggestedVibe || currentVibe,
    playlistTitle: llmResponse.playlistTitle,
    playlistDescription: llmResponse.playlistDescription,
    conversationalResponse: llmResponse.conversationalResponse,
  };
}
