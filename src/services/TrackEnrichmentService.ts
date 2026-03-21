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
const CACHE_VERSION = 3;

function getCached(trackId: string): TrackProfile | null {
  const raw = storage.getString(`${CACHE_KEY_PREFIX}${trackId}`);
  if (!raw) return null;
  try {
    const cached = JSON.parse(raw) as TrackProfile;
    if (!cached.cacheVersion || cached.cacheVersion < CACHE_VERSION) return null;
    return cached;
  } catch {
    storage.remove(`${CACHE_KEY_PREFIX}${trackId}`);
    return null;
  }
}

function setCache(trackId: string, profile: TrackProfile): void {
  storage.set(`${CACHE_KEY_PREFIX}${trackId}`, JSON.stringify(profile));
}

export async function enrichTrack(track: MusicTrack): Promise<TrackProfile> {
  const cached = getCached(track.id);
  if (cached) return cached;

  // Check if the track was already MB-enriched (e.g. from enrichTracksMusicBrainzOnly pass)
  const alreadyMbEnriched = 'mbEnriched' in track && (track as TrackProfile).mbEnriched;

  const profile: TrackProfile = {
    ...track,
    tags: alreadyMbEnriched ? (track as TrackProfile).tags ?? [] : [],
    mbEnriched: alreadyMbEnriched ? true : false,
    hasRichData: false,
    cacheVersion: CACHE_VERSION,
  };

  // MusicBrainz enrichment — skip if already enriched from prior pass
  if (alreadyMbEnriched) {
    console.log(`[Enrichment] Skipping MusicBrainz for "${track.title}" — already enriched`);
    if ((track as TrackProfile).year) {
      profile.year = (track as TrackProfile).year;
    }
  } else {
    try {
      console.log(`[Enrichment] MusicBrainz lookup: "${track.title}" by ${track.artistName}`);
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
      } else {
        console.warn(`[Enrichment] MusicBrainz ${mbResponse.status} for "${track.title}"`);
      }
    } catch (err) {
      console.warn(`[Enrichment] MusicBrainz error for "${track.title}":`, err);
    }
  }

  // Genius enrichment
  try {
    console.log(`[Enrichment] Genius lookup: "${track.title}" by ${track.artistName}`);
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
  } catch (err) {
    console.warn(`[Enrichment] Genius error for "${track.title}":`, err);
    // Non-fatal — still save MusicBrainz data if available
    if (profile.tags?.length || profile.year) {
      profile.enrichedFacts = {
        tags: profile.tags,
        year: profile.year,
      };
    }
  }

  // Only cache if we got meaningful data — don't cache empty failures
  if (profile.mbEnriched || profile.hasRichData) {
    setCache(track.id, profile);
  }
  return profile;
}

export async function enrichTracks(tracks: MusicTrack[]): Promise<TrackProfile[]> {
  const results: TrackProfile[] = [];
  for (let i = 0; i < tracks.length; i++) {
    results.push(await enrichTrack(tracks[i]));
    // Rate limit: MusicBrainz requires max 1 req/sec (1100ms minimum interval)
    if (i < tracks.length - 1) {
      await new Promise((r) => setTimeout(r, 1100));
    }
  }
  return results;
}

export async function enrichTracksMusicBrainzOnly(tracks: MusicTrack[]): Promise<TrackProfile[]> {
  const results: TrackProfile[] = [];
  let cacheHits = 0;
  let apiCalls = 0;
  for (let i = 0; i < tracks.length; i++) {
    const track = tracks[i];
    const cached = getCached(track.id);
    if (cached) {
      cacheHits++;
      results.push(cached);
      continue;
    }

    // Rate limit: MusicBrainz requires max 1 req/sec (1100ms minimum interval)
    if (apiCalls > 0) {
      await new Promise((r) => setTimeout(r, 1100));
    }
    apiCalls++;

    const profile: TrackProfile = {
      ...track,
      tags: [],
      mbEnriched: false,
      hasRichData: false,
      cacheVersion: CACHE_VERSION,
    };

    try {
      console.log(`[Enrichment] MB-only lookup: "${track.title}" by ${track.artistName}`);
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
      } else {
        console.warn(`[Enrichment] MB-only ${mbResponse.status} for "${track.title}"`);
      }
    } catch (err) {
      console.warn(`[Enrichment] MB-only error for "${track.title}":`, err);
    }

    // Don't cache yet — Genius pass will complete the profile
    results.push(profile);
  }
  console.log(`[Enrichment] MB-only done: ${cacheHits} cache hits, ${tracks.length - cacheHits} API calls`);
  return results;
}
