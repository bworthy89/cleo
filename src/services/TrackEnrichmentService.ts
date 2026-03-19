import { authenticatedFetch } from './api';
import { storage } from './Storage';
import type { MusicTrack } from '../../modules/expo-music-kit';

export interface EnrichedFacts {
  // From Genius
  producer?: string;
  songwriter?: string;
  sample?: string;
  context?: string;
  geniusUrl?: string;
  recordingLocation?: string;
  releaseYear?: string;
  // From MusicBrainz
  tags?: string[];
  year?: string;
}

export interface TrackProfile extends MusicTrack {
  tempo?: number;
  tags?: string[];
  year?: string;
  mbEnriched: boolean;
  enrichedFacts?: EnrichedFacts;
  hasRichData: boolean;
  cacheVersion?: number;
}

const CACHE_KEY_PREFIX = 'enrichment:';
const CACHE_VERSION = 2;

function getCached(trackId: string): TrackProfile | null {
  const raw = storage.getString(`${CACHE_KEY_PREFIX}${trackId}`);
  if (!raw) return null;
  const cached = JSON.parse(raw) as TrackProfile;
  if (!cached.cacheVersion || cached.cacheVersion < CACHE_VERSION) return null;
  return cached;
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
    cacheVersion: CACHE_VERSION,
  };

  // MusicBrainz enrichment
  try {
    const mbResponse = await authenticatedFetch('/enrich-musicbrainz', {
      method: 'POST',
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
    const geniusResponse = await authenticatedFetch('/enrich-track', {
      method: 'POST',
      body: JSON.stringify({ title: track.title, artist: track.artistName }),
    });

    if (geniusResponse.ok) {
      const data = await geniusResponse.json();
      const facts = data.enrichedFacts ?? {};

      // Merge Genius facts with MusicBrainz data
      profile.enrichedFacts = {
        ...facts,
        tags: profile.tags?.length ? profile.tags : undefined,
        year: profile.year ?? undefined,
      };

      // Has rich data if we got anything beyond just a URL
      profile.hasRichData = !!(
        facts.producer || facts.songwriter || facts.sample ||
        facts.context || facts.recordingLocation
      );
      console.log(`[Enrichment] "${track.title}" — hasRichData: ${profile.hasRichData}, producer: ${facts.producer ?? 'none'}, songwriter: ${facts.songwriter ?? 'none'}, sample: ${facts.sample ?? 'none'}`);
    }
  } catch {
    // Non-fatal — still save MusicBrainz data if available
    if (profile.tags?.length || profile.year) {
      profile.enrichedFacts = {
        tags: profile.tags,
        year: profile.year,
      };
    }
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

export async function enrichTracksMusicBrainzOnly(tracks: MusicTrack[]): Promise<TrackProfile[]> {
  const results: TrackProfile[] = [];
  for (const track of tracks) {
    const cached = getCached(track.id);
    if (cached) {
      results.push(cached);
      continue;
    }

    const profile: TrackProfile = {
      ...track,
      tags: [],
      mbEnriched: false,
      hasRichData: false,
      cacheVersion: CACHE_VERSION,
    };

    try {
      const mbResponse = await authenticatedFetch('/enrich-musicbrainz', {
        method: 'POST',
        body: JSON.stringify({ title: track.title, artist: track.artistName }),
      });

      if (mbResponse.ok) {
        const data = await mbResponse.json();
        if (data.found) {
          profile.tags = data.tags ?? [];
          profile.year = data.firstReleaseYear ?? undefined;
          profile.mbEnriched = true;
          profile.enrichedFacts = {
            tags: profile.tags?.length ? profile.tags : undefined,
            year: profile.year ?? undefined,
          };
        }
      }
    } catch {
      // Non-fatal
    }

    // Don't cache yet — Genius pass will complete the profile
    results.push(profile);
  }
  return results;
}
