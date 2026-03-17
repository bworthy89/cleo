import { API_BASE_URL } from './api';
import { storage } from './Storage';
import type { MusicTrack } from '../../modules/expo-music-kit';

export interface TrackProfile extends MusicTrack {
  tempo?: number;
  tags?: string[];
  year?: string;
  mbEnriched: boolean;
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
  };

  try {
    const response = await fetch(`${API_BASE_URL}/enrich-musicbrainz`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: track.title, artist: track.artistName }),
    });

    if (response.ok) {
      const data = await response.json();
      if (data.found) {
        profile.tags = data.tags ?? [];
        profile.year = data.firstReleaseYear ?? undefined;
        profile.mbEnriched = true;
      }
    }
  } catch {
    // Enrichment failure is non-fatal
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
