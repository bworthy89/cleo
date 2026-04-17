import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { EnrichmentCache, type EnrichmentRecord } from '@/services/enrichment/EnrichmentCache';

async function tempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'enrich-cache-test-'));
  return dir;
}

const record: EnrichmentRecord = {
  genre: 'soul', moodTags: ['warm', 'smooth'], releaseYear: '1972',
  producer: 'Quincy Jones', lastEnrichedAt: Date.now(), source: 'hybrid',
};

describe('EnrichmentCache', () => {
  let dir: string;
  beforeEach(async () => { dir = await tempDir(); });
  afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); });

  it('returns null for missing key before load', async () => {
    const cache = new EnrichmentCache(path.join(dir, 'tracks.json'));
    await cache.load();
    expect(cache.get('Song', 'Artist')).toBeNull();
  });

  it('writes and reads back a record', async () => {
    const cache = new EnrichmentCache(path.join(dir, 'tracks.json'));
    await cache.load();
    await cache.set('Song', 'Artist', record);
    expect(cache.get('Song', 'Artist')).toMatchObject(record);
  });

  it('persists across reload', async () => {
    const file = path.join(dir, 'tracks.json');
    const first = new EnrichmentCache(file);
    await first.load();
    await first.set('Song', 'Artist', record);

    const second = new EnrichmentCache(file);
    await second.load();
    expect(second.get('Song', 'Artist')).toMatchObject(record);
  });

  it('normalizes keys: (feat. X) collides with base title', async () => {
    const cache = new EnrichmentCache(path.join(dir, 'tracks.json'));
    await cache.load();
    await cache.set('Song', 'Artist', record);
    expect(cache.get('Song (feat. Nobody)', 'Artist')).toMatchObject(record);
  });

  it('normalizes keys: (Remastered YYYY) collides', async () => {
    const cache = new EnrichmentCache(path.join(dir, 'tracks.json'));
    await cache.load();
    await cache.set('Song', 'Artist', record);
    expect(cache.get('Song (Remastered 2020)', 'Artist')).toMatchObject(record);
  });

  it('normalizes keys: - Deluxe Edition collides', async () => {
    const cache = new EnrichmentCache(path.join(dir, 'tracks.json'));
    await cache.load();
    await cache.set('Song', 'Artist', record);
    expect(cache.get('Song - Deluxe Edition', 'Artist')).toMatchObject(record);
  });

  it('is case-insensitive on normalization', async () => {
    const cache = new EnrichmentCache(path.join(dir, 'tracks.json'));
    await cache.load();
    await cache.set('Song', 'Artist', record);
    expect(cache.get('SONG', 'ARTIST')).toMatchObject(record);
  });

  it('tolerates malformed JSON — starts with empty state', async () => {
    const file = path.join(dir, 'tracks.json');
    await fs.writeFile(file, '{ not valid json', 'utf8');
    const cache = new EnrichmentCache(file);
    await cache.load();
    expect(cache.get('Song', 'Artist')).toBeNull();
    await cache.set('Song', 'Artist', record);
    expect(cache.get('Song', 'Artist')).toMatchObject(record);
  });

  it('writes atomically (tmp file then rename)', async () => {
    const file = path.join(dir, 'tracks.json');
    const cache = new EnrichmentCache(file);
    await cache.load();
    await cache.set('Song', 'Artist', record);
    // No leftover .tmp file
    const files = await fs.readdir(dir);
    expect(files.filter(f => f.endsWith('.tmp'))).toHaveLength(0);
    expect(files).toContain('tracks.json');
  });
});
