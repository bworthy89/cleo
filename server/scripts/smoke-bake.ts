/**
 * Smoke test for the bake pipeline. Calls BroadcastOrchestrator.create()
 * directly (no HTTP, no auth) with five canned tracks lifted from the
 * late-night-soul featured config — real artist/title metadata, placeholder
 * IDs. The bake pipeline uses the metadata strings, not the IDs, so this
 * exercises the full LLM + TTS + storage path without needing real Apple
 * Music IDs.
 *
 * Asserts:
 *   - manifest + firstSegmentUrls populated
 *   - cold_open (slot 0) status === 'ready'
 *   - at least cold_open + sign_off in segmentSlots
 *   - every slot reaches a terminal state (ready/failed) within timeout
 *
 * Logs:
 *   - time-to-slot-zero (how long orch.create() blocks)
 *   - time-to-completion (waitForCompletion duration)
 *   - per-slot final status
 *
 * Exit: 0 on success, 1 on any failed assertion or thrown error. CI-friendly.
 */

import 'dotenv/config';
import * as path from 'path';
import { createStorage } from '../src/services/storage/createStorage';
import { BroadcastStore } from '../src/services/broadcast/BroadcastStore';
import { BroadcastOrchestrator } from '../src/services/broadcast/BroadcastOrchestrator';
import { EnrichmentCache } from '../src/services/enrichment/EnrichmentCache';
import { BackgroundEnricher } from '../src/services/enrichment/BackgroundEnricher';
import { DefaultEnrichmentFetcher } from '../src/services/enrichment/DefaultEnrichmentFetcher';
import { ReccoBeatsFetcher } from '../src/services/enrichment/fetchers/ReccoBeatsFetcher';
import { DeezerFeaturesFetcher } from '../src/services/enrichment/fetchers/DeezerFeaturesFetcher';
import { FeatureFetchChain } from '../src/services/broadcast/FeatureFetchChain';
import { llmProvider } from '../src/providers/llm';
import { ttsProvider } from '../src/providers/tts';
import type { BroadcastCreateRequest } from '../src/services/broadcast/types';

const COMPLETION_TIMEOUT_MS = 60_000;

const TRACKS: BroadcastCreateRequest['tracks'] = [
  { id: '1001', title: 'Pyramids', artistName: 'Frank Ocean', albumTitle: 'Channel Orange', duration: 600 },
  { id: '1002', title: 'Nikes', artistName: 'Frank Ocean', albumTitle: 'Blonde', duration: 314 },
  { id: '1003', title: 'Redbone', artistName: 'Childish Gambino', albumTitle: 'Awaken, My Love!', duration: 306 },
  { id: '1004', title: 'Passionfruit', artistName: 'Drake', albumTitle: 'More Life', duration: 298 },
  { id: '1005', title: 'Cranes in the Sky', artistName: 'Solange', albumTitle: 'A Seat at the Table', duration: 251 },
];

function fail(message: string): never {
  console.error(`\n[smoke:bake] FAIL — ${message}`);
  process.exit(1);
}

async function main() {
  console.log('[smoke:bake] start');

  const storage = createStorage({
    ...process.env,
    BROADCAST_CACHE_DIR: process.env.BROADCAST_CACHE_DIR
      ?? path.resolve(__dirname, '../.broadcast-cache'),
  });
  const store = new BroadcastStore();
  const enrichmentCache = new EnrichmentCache(
    path.resolve(__dirname, '../.enrichment-cache/tracks.json'),
  );
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

  const input: BroadcastCreateRequest & { userId: string } = {
    playlistId: null,
    vibe: 'lateNight',
    length: 'quick',
    userContext: {
      timeOfDay: 'late night',
      dayOfWeek: 'Friday',
      firstTimeUser: false,
    },
    tracks: TRACKS,
    userId: 'smoke',
  };

  const t0 = Date.now();
  const result = await orch.create(input);
  const slotZeroMs = Date.now() - t0;
  console.log(`[smoke:bake] time-to-slot-zero: ${slotZeroMs}ms`);

  if (!result?.manifest) fail('orch.create returned no manifest');
  if (!Array.isArray(result.firstSegmentUrls) || result.firstSegmentUrls.length === 0) {
    fail('firstSegmentUrls is empty — cold_open audio missing');
  }

  const slots = result.manifest.segmentSlots;
  if (!Array.isArray(slots) || slots.length < 2) {
    fail(`segmentSlots.length=${slots?.length ?? 0}, expected at least 2 (cold_open + sign_off)`);
  }
  if (slots[0].status !== 'ready') {
    fail(`segmentSlots[0].status='${slots[0].status}', expected 'ready'`);
  }
  console.log(`[smoke:bake] manifest ok: id=${result.manifest.broadcastId} slots=${slots.length}`);

  const t1 = Date.now();
  await Promise.race([
    orch.waitForCompletion(result.manifest.broadcastId),
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`waitForCompletion exceeded ${COMPLETION_TIMEOUT_MS}ms`)),
        COMPLETION_TIMEOUT_MS,
      ),
    ),
  ]);
  const completionMs = Date.now() - t1;
  console.log(`[smoke:bake] time-to-completion: ${completionMs}ms`);

  // Re-read the manifest from the store; segmentSlots in `result` is a snapshot
  // from create() and won't reflect background slot completions.
  const finalManifest = store.get(result.manifest.broadcastId);
  if (!finalManifest) fail('manifest missing from store after completion');

  const finalSlots = finalManifest.segmentSlots;
  console.log('[smoke:bake] per-slot final status:');
  finalSlots.forEach((s, i) => {
    const target = s.beforeTrackId ?? '-';
    console.log(`  [${i}] tier=${s.tier ?? '?'} status=${s.status} beforeTrack=${target}`);
  });

  const stillPending = finalSlots.filter((s) => s.status === 'pending');
  if (stillPending.length > 0) {
    fail(`${stillPending.length} slot(s) still pending after waitForCompletion`);
  }

  const failed = finalSlots.filter((s) => s.status === 'failed');
  if (failed.length > 0) {
    console.warn(`[smoke:bake] WARN — ${failed.length} slot(s) ended 'failed' (pipeline ok, content degraded)`);
  }

  console.log(`\n[smoke:bake] PASS — slot0=${slotZeroMs}ms total=${slotZeroMs + completionMs}ms slots=${finalSlots.length} ready=${finalSlots.filter((s) => s.status === 'ready').length} failed=${failed.length}`);
  process.exit(0);
}

main().catch((err) => {
  console.error('[smoke:bake] FAIL — unhandled error');
  console.error(err);
  process.exit(1);
});
