import { EnrichmentCache, type EnrichmentRecord } from '@/services/enrichment/EnrichmentCache';
import { Db } from '@/services/db/Db';

const newCache = (): { db: Db; cache: EnrichmentCache } => {
  const db = new Db(':memory:');
  return { db, cache: new EnrichmentCache(db) };
};

const sampleRecord = (overrides: Partial<EnrichmentRecord> = {}): EnrichmentRecord => ({
  genre: 'house',
  moodTags: ['driving'],
  lastEnrichedAt: 1_700_000_000_000,
  source: 'genius',
  ...overrides,
});

describe('EnrichmentCache (sqlite)', () => {
  it('load() resolves immediately (no-op)', async () => {
    const { db, cache } = newCache();
    await expect(cache.load()).resolves.toBeUndefined();
    db.close();
  });

  it('returns null for missing entries', () => {
    const { db, cache } = newCache();
    expect(cache.get('Title', 'Artist')).toBeNull();
    db.close();
  });

  it('writes and reads back a record (key normalization preserved)', async () => {
    const { db, cache } = newCache();
    const rec = sampleRecord();
    await cache.set('Title (feat. X)', 'Artist', rec);
    expect(cache.get('Title', 'Artist')).toEqual(rec);
    expect(cache.get('TITLE   (feat. someone)', 'artist')).toEqual(rec);
    db.close();
  });

  it('normalizes keys: (Remastered YYYY) collides', async () => {
    const { db, cache } = newCache();
    await cache.set('Song', 'Artist', sampleRecord());
    expect(cache.get('Song (Remastered 2020)', 'Artist')).not.toBeNull();
    db.close();
  });

  it('normalizes keys: - Deluxe Edition collides', async () => {
    const { db, cache } = newCache();
    await cache.set('Song', 'Artist', sampleRecord());
    expect(cache.get('Song - Deluxe Edition', 'Artist')).not.toBeNull();
    db.close();
  });

  it('overwrites existing entries on set', async () => {
    const { db, cache } = newCache();
    await cache.set('T', 'A', sampleRecord({ genre: 'house' }));
    await cache.set('T', 'A', sampleRecord({ genre: 'techno' }));
    expect(cache.get('T', 'A')!.genre).toBe('techno');
    db.close();
  });

  it('persists across cache instances on the same Db', async () => {
    const { db, cache } = newCache();
    await cache.set('T', 'A', sampleRecord());
    const second = new EnrichmentCache(db);
    expect(second.get('T', 'A')).not.toBeNull();
    db.close();
  });

  it('returns null for malformed data_json (matches file-backed tolerance)', () => {
    const { db, cache } = newCache();
    db.prepare(
      "INSERT INTO enrichment (track_key, data_json, fetched_at, source) VALUES (?, ?, ?, ?)",
    ).run('badkey|badartist', '{not valid json', 0, 'genius');
    expect(cache.get('badkey', 'badartist')).toBeNull();
    db.close();
  });
});
