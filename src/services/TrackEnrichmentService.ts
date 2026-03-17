import { API_BASE_URL } from './api';
import { storage } from './Storage';
import type { MusicTrack } from '../../modules/expo-music-kit';

export interface EnrichedFacts {
  producer?: string;
  songwriter?: string;
  sample?: string;
  context?: string;
  geniusUrl?: string;
}

export interface TrackProfile extends MusicTrack {
  tempo?: number;
  tags?: string[];
  year?: string;
  mbEnriched: boolean;
  enrichedFacts?: EnrichedFacts;
  hasRichData: boolean;
}

const CACHE_KEY_PREFIX = 'enrichment:';

function getCached(trackId: string): TrackProfile | null {
  const raw = storage.getString(`${CACHE_KEY_PREFIX}${trackId}`);
  return raw ? JSON.parse(raw) : null;
}

function setCache(trackId: string, profile: TrackProfile): void {
  storage.set(`${CACHE_KEY_PREFIX}${trackId}`, JSON.stringify(profile));
}

export async function enrichTrack(track: MusicTrack): Promise<TrackProfile> {
  const cached = getCached(track.id);
  if (cached) return cached;

  const profile: TrackProfile = {
    ...track,
    tags: [],
    mbEnriched: false,
    hasRichData: false,
  };

  // MusicBrainz enrichment
  try {
    const mbResponse = await fetch(`${API_BASE_URL}/enrich-musicbrainz`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: track.title, artist: track.artistName }),
    });

    if (mbResponse.ok) {
      const data = await mbResponse.json();
      if (data.found) {
        profile.tags = data.tags ?? [];
        profile.year = data.firstReleaseYear ?? undefined;
        profile.mbEnriched = true;
      }
    }
  } catch {
    // Non-fatal
  }

  // Genius enrichment
  try {
    const geniusResponse = await fetch(`${API_BASE_URL}/enrich-track`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: track.title, artist: track.artistName }),
    });

    if (geniusResponse.ok) {
      const data = await geniusResponse.json();
      if (data.results && data.results.length > 0) {
        const topResult = data.results[0];
        profile.enrichedFacts = {
          geniusUrl: topResult.url,
        };
        profile.hasRichData = true;
      }
    }
  } catch {
    // Non-fatal
  }

  setCache(track.id, profile);
  return profile;
}

export async function enrichTracks(tracks: MusicTrack[]): Promise<TrackProfile[]> {
  const results: TrackProfile[] = [];
  for (const track of tracks) {
    results.push(await enrichTrack(track));
  }
  return results;
}
