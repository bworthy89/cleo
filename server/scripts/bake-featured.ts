import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { createStorage } from '../src/services/storage/createStorage';
import { BroadcastStore } from '../src/services/broadcast/BroadcastStore';
import { Db } from '../src/services/db/Db';
import { BroadcastOrchestrator } from '../src/services/broadcast/BroadcastOrchestrator';
import { FeaturedBroadcastRegistry } from '../src/services/broadcast/FeaturedBroadcastRegistry';
import { bakeFeatured } from '../src/services/broadcast/bakeFeatured';
import { EnrichmentCache } from '../src/services/enrichment/EnrichmentCache';
import { BackgroundEnricher } from '../src/services/enrichment/BackgroundEnricher';
import { DefaultEnrichmentFetcher } from '../src/services/enrichment/DefaultEnrichmentFetcher';
import { ReccoBeatsFetcher } from '../src/services/enrichment/fetchers/ReccoBeatsFetcher';
import { DeezerFeaturesFetcher } from '../src/services/enrichment/fetchers/DeezerFeaturesFetcher';
import { FeatureFetchChain } from '../src/services/broadcast/FeatureFetchChain';
import { llmProvider } from '../src/providers/llm';
import { ttsProvider } from '../src/providers/tts';

async function main() {
  const configPath = process.argv[2];
  if (!configPath) {
    console.error('usage: tsx scripts/bake-featured.ts <config.json>');
    process.exit(1);
  }
  const resolvedConfig = path.resolve(configPath);

  const storage = createStorage({
    ...process.env,
    BROADCAST_CACHE_DIR: process.env.BROADCAST_CACHE_DIR
      ?? path.resolve(__dirname, '../.broadcast-cache'),
  });
  const dbPath = process.env.SQLITE_DB_PATH
    ?? path.resolve(__dirname, '../.broadcast-cache/cleo.db');
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Db(dbPath);
  try {
    const store = new BroadcastStore(db);
    const enrichmentCache = new EnrichmentCache(db);
    await enrichmentCache.load();
    const recco = new ReccoBeatsFetcher();
    const deezer = new DeezerFeaturesFetcher();
    const lastFmTags = {
      async get(title: string, artist: string): Promise<string[]> {
        const rec = enrichmentCache.get(title, artist);
        return rec?.moodTags ?? [];
      },
    };
    const featureFetchChain = new FeatureFetchChain({ recco, deezer, lastFmTags });
    const backgroundEnricher = new BackgroundEnricher(
      enrichmentCache, new DefaultEnrichmentFetcher(), featureFetchChain,
    );
    const orch = new BroadcastOrchestrator(
      llmProvider, ttsProvider, storage, store,
      enrichmentCache, backgroundEnricher, featureFetchChain,
    );

    const registry = new FeaturedBroadcastRegistry(db);
    await registry.load();

    console.log(`Baking featured broadcast from ${resolvedConfig}...`);
    const record = await bakeFeatured({ configPath: resolvedConfig, orchestrator: orch, registry });
    console.log(`Done. Baked ${record.id} with ${record.manifest.segmentSlots.length} segments.`);
  } catch (err) {
    console.error(err);
    process.exitCode = 1;
  } finally {
    try { db.close(); } catch (err) { console.warn('[bake-featured] db.close failed:', err); }
  }
  process.exit(process.exitCode ?? 0);
}
