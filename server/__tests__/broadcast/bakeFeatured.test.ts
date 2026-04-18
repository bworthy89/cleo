import { bakeFeatured } from '@/services/broadcast/bakeFeatured';
import { FeaturedBroadcastRegistry } from '@/services/broadcast/FeaturedBroadcastRegistry';
import { BroadcastOrchestrator } from '@/services/broadcast/BroadcastOrchestrator';
import { BroadcastStore } from '@/services/broadcast/BroadcastStore';
import { EnrichmentCache } from '@/services/enrichment/EnrichmentCache';
import { BackgroundEnricher } from '@/services/enrichment/BackgroundEnricher';
import { makeMockLLM } from '../../__mocks__/llm';
import { makeMockTTS } from '../../__mocks__/tts';
import type { ObjectStorage } from '@/services/storage/ObjectStorage';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

const SEQUENCER_RESPONSE = JSON.stringify({
  ordered: ['t0', 't1', 't2', 't3', 't4'],
});

const makeStorage = (): ObjectStorage => ({
  put: jest.fn(async (k: string) => `https://cdn/${k}`),
  getAbsolutePath: jest.fn(),
});

describe('bakeFeatured', () => {
  let tmp: string;
  let regPath: string;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'bake-'));
    regPath = path.join(tmp, 'registry.json');
  });

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('bakes a featured broadcast and stores it in the registry', async () => {
    const configPath = path.join(tmp, 'c.json');
    await fs.writeFile(configPath, JSON.stringify({
      id: 'c1', title: 'Cozy', description: 'D', vibe: 'morning', length: 'quick',
      tracks: Array.from({ length: 5 }, (_, i) => ({
        id: `t${i}`, title: `T${i}`, artistName: 'A', albumTitle: 'AL', duration: 200,
      })),
    }));

    const reg = new FeaturedBroadcastRegistry(regPath);
    await reg.load();
    const enrichCache = new EnrichmentCache(path.join(tmp, 'tracks.json'));
    await enrichCache.load();
    const enricher = new BackgroundEnricher(enrichCache, {
      fetchGenius: jest.fn(async () => null),
      fetchMusicBrainz: jest.fn(async () => null),
      fetchWikipedia: async () => null,
      fetchLastFm: async () => null,
      fetchSpotify: async () => null,
    });
    const orch = new BroadcastOrchestrator(
      makeMockLLM(SEQUENCER_RESPONSE), makeMockTTS(), makeStorage(),
      new BroadcastStore(), enrichCache, enricher,
    );

    await bakeFeatured({ configPath, orchestrator: orch, registry: reg });

    const list = reg.list();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('c1');
    expect(list[0].baked).toBe(true);
    expect(list[0].manifest.segmentSlots.every(s => s.status === 'ready')).toBe(true);
  });
});
