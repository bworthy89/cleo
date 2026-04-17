import { authenticatedFetch } from '../services/api';
import { searchCatalog, CatalogSearchResult } from '../../modules/expo-music-kit';
import { TrackProfile } from '../services/TrackEnrichmentService';
import type { Vibe } from '../cleo/fallbacks';

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

export interface CuratedPlaylist {
  tracks: TrackProfile[];
  trackIds: string[];
  suggestedVibe: Vibe;
  playlistTitle: string;
  playlistDescription: string;
  conversationalResponse: string;
}

const SEARCH_BATCH_SIZE = 5;
const GAP_FILL_THRESHOLD = 0.2; // 20% unmatched triggers gap-fill
const SEARCH_TIMEOUT_MS = 45000;

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

function fuzzyMatch(a: string, b: string): boolean {
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  return normalize(a).includes(normalize(b)) || normalize(b).includes(normalize(a));
}

function findBestMatch(
  suggestion: LLMTrackSuggestion,
  results: CatalogSearchResult[]
): CatalogSearchResult | null {
  for (const result of results) {
    if (
      fuzzyMatch(result.title, suggestion.title) &&
      fuzzyMatch(result.artistName, suggestion.artist)
    ) {
      return result;
    }
  }
  // Fallback: just match title if artist is close
  for (const result of results) {
    if (fuzzyMatch(result.title, suggestion.title)) {
      return result;
    }
  }
  return null;
}

async function searchBatch(
  suggestions: LLMTrackSuggestion[]
): Promise<{ matched: Map<number, CatalogSearchResult>; unmatched: number[] }> {
  const matched = new Map<number, CatalogSearchResult>();
  const unmatched: number[] = [];

  // Process in batches
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

export async function curatePlaylist(
  request: CurationRequest
): Promise<CuratedPlaylist> {
  // Step 1: Get LLM suggestions
  const llmResponse = await callCurateEndpoint({
    prompt: request.prompt,
    trackCount: request.trackCount ?? 20,
    round: 'initial',
  });

  // Step 2: Search catalog for each suggestion
  const { matched, unmatched } = await searchBatch(llmResponse.tracks);

  // Step 3: Gap-fill if too many unmatched
  let finalMatched = matched;
  if (unmatched.length / llmResponse.tracks.length > GAP_FILL_THRESHOLD) {
    const unmatchedSuggestions = unmatched.map(i => llmResponse.tracks[i]);
    const matchedSuggestions = Array.from(matched.entries()).map(([i]) => llmResponse.tracks[i]);

    const gapFillResponse = await callCurateEndpoint({
      prompt: request.prompt,
      trackCount: unmatched.length,
      round: 'gap-fill',
      existingTracks: matchedSuggestions,
      unmatchedTracks: unmatchedSuggestions,
    });

    const { matched: gapMatched } = await searchBatch(gapFillResponse.tracks);

    // Merge gap-fill matches
    let nextIdx = llmResponse.tracks.length;
    for (const [, result] of gapMatched) {
      finalMatched.set(nextIdx++, result);
    }
  }

  // Step 4: Build TrackProfiles in the LLM-provided order
  const orderedIndexes = Array.from(finalMatched.keys()).sort((a, b) => a - b);
  const trackProfiles = orderedIndexes
    .map(idx => finalMatched.get(idx)!)
    .map(catalogResultToTrackProfile);

  if (trackProfiles.length < 5) {
    throw new Error('Too few tracks matched. Try a different prompt.');
  }

  return {
    tracks: trackProfiles,
    trackIds: trackProfiles.map(t => t.id),
    suggestedVibe: llmResponse.suggestedVibe,
    playlistTitle: llmResponse.playlistTitle,
    playlistDescription: llmResponse.playlistDescription,
    conversationalResponse: llmResponse.conversationalResponse,
  };
}

export async function refinePlaylist(
  request: RefinementRequest,
  originalPrompt: string,
  currentVibe: Vibe
): Promise<CuratedPlaylist> {
  // Step 1: Get LLM refinement suggestions
  const llmResponse = await callCurateEndpoint({
    prompt: originalPrompt,
    trackCount: request.existingTracks.length,
    round: 'refinement',
    existingTracks: request.existingTracks,
    userFeedback: request.userFeedback,
  });

  // Step 2: Search catalog for any new tracks, preserving LLM order
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
