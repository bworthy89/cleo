import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Db } from '@/services/db/Db';
import { backfill } from '@/scripts/backfill-sqlite';

describe('backfill-sqlite', () => {
  let workDir: string;
  beforeEach(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cleo-backfill-'));
  });
  afterEach(() => {
    fs.rmSync(workDir, { recursive: true, force: true });
  });

  it('inserts enrichment rows from tracks.json', async () => {
    const db = new Db(':memory:');
    const enrichmentJson = path.join(workDir, 'tracks.json');
    fs.writeFileSync(enrichmentJson, JSON.stringify({
      version: 1,
      tracks: {
        'song one|artist a': {
          genre: 'house',
          lastEnrichedAt: 1_700_000_000_000,
          source: 'genius',
        },
        'song two|artist b': {
          genre: 'techno',
          lastEnrichedAt: 1_700_000_000_001,
          source: 'musicbrainz',
        },
      },
    }));
    await backfill({
      db,
      enrichmentJsonPath: enrichmentJson,
      registryJsonPath: path.join(workDir, 'registry.json'), // missing — fine
    });
    const { n } = db.prepare<{ n: number }>('SELECT COUNT(*) AS n FROM enrichment').get();
    expect(n).toBe(2);
    db.close();
  });

  it('inserts featured rows from registry.json', async () => {
    const db = new Db(':memory:');
    const registryJson = path.join(workDir, 'registry.json');
    fs.writeFileSync(registryJson, JSON.stringify({
      records: [{
        id: 'feat-a', title: 'T', description: 'D', vibe: 'morning', length: 'standard',
        baked: true, createdAt: 1_700_000_000_000,
        manifest: {
          broadcastId: 'feat-a', userId: 'curator', playlistId: null,
          vibe: 'morning', length: 'standard', createdAt: 1_700_000_000_000,
          tracks: [], segmentSlots: [],
        },
      }],
    }));
    await backfill({
      db,
      enrichmentJsonPath: path.join(workDir, 'tracks.json'),
      registryJsonPath: registryJson,
    });
    const { n } = db.prepare<{ n: number }>('SELECT COUNT(*) AS n FROM featured_broadcasts').get();
    expect(n).toBe(1);
    db.close();
  });

  it('is idempotent — second run inserts zero new rows', async () => {
    const db = new Db(':memory:');
    const enrichmentJson = path.join(workDir, 'tracks.json');
    fs.writeFileSync(enrichmentJson, JSON.stringify({
      version: 1,
      tracks: {
        'song one|artist a': { genre: 'house', lastEnrichedAt: 1, source: 'genius' },
      },
    }));
    const opts = {
      db,
      enrichmentJsonPath: enrichmentJson,
      registryJsonPath: path.join(workDir, 'missing.json'),
    };
    const first = await backfill(opts);
    const second = await backfill(opts);
    expect(first.enrichmentInserted).toBe(1);
    expect(second.enrichmentInserted).toBe(0);
    db.close();
  });

  it('tolerates missing input files (logs and skips)', async () => {
    const db = new Db(':memory:');
    const result = await backfill({
      db,
      enrichmentJsonPath: path.join(workDir, 'missing-enrich.json'),
      registryJsonPath: path.join(workDir, 'missing-registry.json'),
    });
    expect(result.enrichmentInserted).toBe(0);
    expect(result.featuredInserted).toBe(0);
    db.close();
  });
});
