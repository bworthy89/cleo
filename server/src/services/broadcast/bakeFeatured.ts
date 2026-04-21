import * as fs from 'fs/promises';
import type { BroadcastOrchestrator } from './BroadcastOrchestrator';
import type { FeaturedBroadcastRegistry, FeaturedBroadcast } from './FeaturedBroadcastRegistry';
import type { Manifest, ManifestTrack } from './types';

interface FeaturedConfig {
  id: string;
  title: string;
  description: string;
  vibe: Manifest['vibe'];
  length: Manifest['length'];
  artworkUrl?: string;
  curatorListenerName?: string;
  tracks: ManifestTrack[];
}

export async function bakeFeatured(input: {
  configPath: string;
  orchestrator: BroadcastOrchestrator;
  registry: FeaturedBroadcastRegistry;
}): Promise<FeaturedBroadcast> {
  const raw = await fs.readFile(input.configPath, 'utf8');
  const config = JSON.parse(raw) as FeaturedConfig;

  const { manifest: initialManifest } = await input.orchestrator.create({
    userId: 'curator',
    playlistId: null,
    vibe: config.vibe,
    length: config.length,
    tracks: config.tracks,
    userContext: {
      timeOfDay: '12:00',
      dayOfWeek: '',
      firstTimeUser: false,
      listenerName: config.curatorListenerName,
    },
    // Curator already chose the track order in the config. Skip the
    // deterministic sequencer's re-shuffle so the featured broadcast
    // plays as the curator intended.
    preserveOrder: true,
  });

  await input.orchestrator.waitForCompletion(initialManifest.broadcastId);

  // Re-read the final manifest so slot statuses + audio URLs reflect the
  // completed async phase (the snapshot from create() only had slot 0 ready).
  const finalManifest =
    input.orchestrator.getManifest(initialManifest.broadcastId) ?? initialManifest;

  const record: FeaturedBroadcast = {
    id: config.id,
    title: config.title,
    description: config.description,
    vibe: config.vibe,
    length: config.length,
    artworkUrl: config.artworkUrl,
    baked: true,
    createdAt: Date.now(),
    manifest: finalManifest,
  };
  await input.registry.put(record);
  return record;
}
