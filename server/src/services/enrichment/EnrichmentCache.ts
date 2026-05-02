import type { AudioFeatures } from '../broadcast/audio-features';
import type { Db } from '../db/Db';

export interface EnrichmentRecord {
  genre?: string;
  moodTags?: string[];
  releaseYear?: string;
  producer?: string;
  sample?: string;
  wikipediaSummary?: string;
  notableFacts?: string[];
  artistBio?: string;
  lastEnrichedAt: number;
  source: 'genius' | 'musicbrainz' | 'wikipedia' | 'lastfm' | 'hybrid' | 'reccobeats';

  isrc?: string;
  features?: AudioFeatures;
  featuresSource?: 'reccobeats' | 'synthesized' | 'defaults';
  featuresAt?: number;
  featuresVersion?: number;
}

function normalizeKey(title: string, artist: string): string {
  const clean = (s: string): string => s
    .toLowerCase()
    .replace(/\(feat\.[^)]*\)/gi, '')
    .replace(/\(remastered[^)]*\)/gi, '')
    .replace(/-\s*deluxe[^|]*/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  return `${clean(title)}|${clean(artist)}`;
}

interface Row {
  data_json: string;
}

export class EnrichmentCache {
  constructor(private readonly db: Db) {}

  /**
   * Kept on the API for shape compatibility with the file-backed predecessor.
   * The SQLite-backed cache has no in-memory map to populate; reads hit the
   * table directly. Existing call sites that `await cache.load()` keep working.
   */
  async load(): Promise<void> {
    return;
  }

  get(title: string, artist: string): EnrichmentRecord | null {
    const key = normalizeKey(title, artist);
    const row = this.db.prepare<Row>(
      'SELECT data_json FROM enrichment WHERE track_key = ?',
    ).get(key);
    if (!row) return null;
    try {
      return JSON.parse(row.data_json) as EnrichmentRecord;
    } catch {
      // A corrupt row would otherwise crash buildSegmentPrompts. Match the
      // file-backed predecessor's malformed-JSON tolerance: treat it as a miss
      // so the enricher will refetch on the next pass.
      return null;
    }
  }

  async set(title: string, artist: string, record: EnrichmentRecord): Promise<void> {
    const key = normalizeKey(title, artist);
    this.db.prepare(
      `INSERT INTO enrichment (track_key, data_json, fetched_at, source)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(track_key) DO UPDATE SET
         data_json = excluded.data_json,
         fetched_at = excluded.fetched_at,
         source = excluded.source`,
    ).run(key, JSON.stringify(record), record.lastEnrichedAt, record.source);
  }
}
