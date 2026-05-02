import * as fs from 'fs';
import * as path from 'path';
import { Db } from '../services/db/Db';
import type { EnrichmentRecord } from '../services/enrichment/EnrichmentCache';
import type { FeaturedBroadcast } from '../services/broadcast/FeaturedBroadcastRegistry';

interface BackfillOptions {
  db: Db;
  enrichmentJsonPath: string;
  registryJsonPath: string;
}

interface BackfillResult {
  enrichmentInserted: number;
  featuredInserted: number;
}

interface CacheFile {
  version?: number;
  tracks?: Record<string, EnrichmentRecord>;
}

interface RegistrySnapshot {
  records?: FeaturedBroadcast[];
}

function readJsonOrNull<T>(filePath: string): T | null {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw) as T;
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException | null)?.code;
    if (code === 'ENOENT') return null;
    throw err;
  }
}

export async function backfill(opts: BackfillOptions): Promise<BackfillResult> {
  let enrichmentInserted = 0;
  let featuredInserted = 0;

  const enrich = readJsonOrNull<CacheFile>(opts.enrichmentJsonPath);
  if (enrich?.tracks) {
    const stmt = opts.db.prepare(
      `INSERT OR IGNORE INTO enrichment (track_key, data_json, fetched_at, source)
       VALUES (?, ?, ?, ?)`,
    );
    for (const [key, rec] of Object.entries(enrich.tracks)) {
      const result = stmt.run(key, JSON.stringify(rec), rec.lastEnrichedAt, rec.source);
      if (result.changes > 0) enrichmentInserted++;
    }
    console.log(`[backfill] enrichment: ${enrichmentInserted} rows inserted from ${opts.enrichmentJsonPath}`);
  } else {
    console.log(`[backfill] enrichment: source file missing or empty (${opts.enrichmentJsonPath}) — skipped`);
  }

  const registry = readJsonOrNull<RegistrySnapshot>(opts.registryJsonPath);
  if (registry?.records) {
    const stmt = opts.db.prepare(
      `INSERT OR IGNORE INTO featured_broadcasts
       (id, slot, theme_day, title, description, vibe, length, artwork_url, baked, created_at, manifest_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const rec of registry.records) {
      const result = stmt.run(
        rec.id,
        rec.slot ?? null,
        rec.themeDay ?? null,
        rec.title,
        rec.description,
        rec.vibe,
        rec.length,
        rec.artworkUrl ?? null,
        rec.baked ? 1 : 0,
        rec.createdAt,
        JSON.stringify(rec.manifest),
      );
      if (result.changes > 0) featuredInserted++;
    }
    console.log(`[backfill] featured: ${featuredInserted} rows inserted from ${opts.registryJsonPath}`);
  } else {
    console.log(`[backfill] featured: source file missing or empty (${opts.registryJsonPath}) — skipped`);
  }

  return { enrichmentInserted, featuredInserted };
}

// CLI entry point — invoked via `tsx src/scripts/backfill-sqlite.ts` on the VPS.
async function main(): Promise<void> {
  const dbPath = process.env.SQLITE_DB_PATH
    ?? path.resolve(__dirname, '../../.broadcast-cache/cleo.db');
  const enrichmentJsonPath = process.env.ENRICHMENT_JSON_PATH
    ?? path.resolve(__dirname, '../../.enrichment-cache/tracks.json');
  const registryJsonPath = process.env.REGISTRY_JSON_PATH
    ?? path.resolve(__dirname, '../../featured-broadcasts/registry.json');

  console.log(`[backfill] db=${dbPath}`);
  const db = new Db(dbPath);
  try {
    const result = await backfill({ db, enrichmentJsonPath, registryJsonPath });
    console.log('[backfill] done', result);
  } finally {
    db.close();
  }
}

if (require.main === module) {
  main().catch(err => { console.error('[backfill] failed:', err); process.exit(1); });
}
