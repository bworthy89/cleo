import type { Vibe, BroadcastLength, ManifestTrack } from './types';
import type { LLMCaller } from './SegmentGenerator';
import { VIBE_ARCS } from './vibe-arcs';
import { SequenceCache } from './SequenceCache';
import type { EnrichmentCache } from '../enrichment/EnrichmentCache';
import { repairSequence, removeDuplicates } from './sequence-repair';

const POOL_CAP = 40;
const MAX_LLM_ATTEMPTS = 2;

const LENGTH_TO_N: Record<BroadcastLength, number> = {
  quick: 5, standard: 9, long: 15,
};

export interface SequenceRequest {
  pool: ManifestTrack[];
  vibe: Vibe;
  length: BroadcastLength;
  userContext: { timeOfDay: string; dayOfWeek: string };
}

export interface SequenceResult {
  orderedTracks: ManifestTrack[];
  source: 'cache' | 'llm' | 'fallback';
}

const SYSTEM_PROMPT = `You are a radio programmer arranging a broadcast. You receive a pool of tracks and a target arc. Return a JSON array of N track IDs in the order they should play, chosen to best fit the arc using the pool provided.

Preferred and avoid lists are aesthetic hints, not rules. If the pool has few tracks matching preferred, adapt \u2014 find tracks closest to the arc's feel. Never refuse. Your job is to make the best broadcast possible from THESE tracks, whatever they are.

Hard constraints:
- Output is valid JSON, exactly { "ordered": ["trackId", ...] }
- Every ID must exist in the pool (no hallucination)
- Length is exactly N
- No track appears twice
- Return ONLY the JSON object, no prose before or after`;

export class TrackSequencer {
  constructor(
    private readonly llm: LLMCaller,
    private readonly cache: SequenceCache,
    private readonly enrichmentCache: EnrichmentCache,
  ) {}

  async sequence(req: SequenceRequest): Promise<SequenceResult> {
    const N = LENGTH_TO_N[req.length];
    if (req.pool.length < N) {
      throw new Error(`insufficient tracks: need ${N}, got ${req.pool.length}`);
    }
    const cappedPool = req.pool.slice(0, POOL_CAP);
    const trackIds = cappedPool.map(t => t.id);

    const cachedIds = this.cache.get(trackIds, req.vibe, req.length);
    if (cachedIds) {
      const byId = new Map(cappedPool.map(t => [t.id, t]));
      const ordered = cachedIds
        .map(id => byId.get(id))
        .filter((t): t is ManifestTrack => t !== undefined);
      if (ordered.length === N) {
        return { orderedTracks: ordered, source: 'cache' };
      }
    }

    for (let attempt = 0; attempt < MAX_LLM_ATTEMPTS; attempt++) {
      try {
        const ordered = await this.attemptSequence(cappedPool, req, N);
        this.cache.set(trackIds, req.vibe, req.length, ordered.map(t => t.id));
        return { orderedTracks: ordered, source: 'llm' };
      } catch {
        // retry or fall through
      }
    }

    return { orderedTracks: cappedPool.slice(0, N), source: 'fallback' };
  }

  private async attemptSequence(
    pool: ManifestTrack[], req: SequenceRequest, N: number,
  ): Promise<ManifestTrack[]> {
    const { systemPrompt, userPrompt } = this.buildPrompt(pool, req, N);
    const response = await this.llm.generate({
      systemPrompt, userPrompt, maxTokens: 2048, temperature: 0.6,
    });
    const parsed = this.parseOrdered(response.text);
    if (parsed.length !== N) {
      throw new Error(`wrong length: got ${parsed.length}, expected ${N}`);
    }
    const byId = new Map(pool.map(t => [t.id, t]));
    const hydrated = parsed.map(id => {
      const t = byId.get(id);
      if (!t) throw new Error(`hallucinated id: ${id}`);
      return t;
    });
    const deduped = removeDuplicates(hydrated, pool);
    const repaired = repairSequence({ ordered: deduped, pool });
    return repaired.ordered.slice(0, N);
  }

  private parseOrdered(raw: string): string[] {
    // LLMs sometimes wrap JSON in ```json ... ``` or add preamble. Extract.
    const firstBrace = raw.indexOf('{');
    const lastBrace = raw.lastIndexOf('}');
    if (firstBrace === -1 || lastBrace === -1) {
      throw new Error('no JSON object found');
    }
    const jsonStr = raw.slice(firstBrace, lastBrace + 1);
    const parsed = JSON.parse(jsonStr) as { ordered?: unknown };
    if (!Array.isArray(parsed.ordered)) {
      throw new Error('ordered is not an array');
    }
    if (!parsed.ordered.every((x): x is string => typeof x === 'string')) {
      throw new Error('ordered contains non-string');
    }
    return parsed.ordered;
  }

  private buildPrompt(
    pool: ManifestTrack[], req: SequenceRequest, N: number,
  ): { systemPrompt: string; userPrompt: string } {
    const arc = VIBE_ARCS[req.vibe];
    const enrichedPool = pool.map(t => {
      const enrichment = this.enrichmentCache.get(t.title, t.artistName);
      const enrichmentStr = enrichment
        ? ` [${[
            enrichment.genre,
            enrichment.releaseYear,
            enrichment.producer ? `prod: ${enrichment.producer}` : null,
            enrichment.moodTags?.length ? `mood: ${enrichment.moodTags.join(',')}` : null,
          ].filter(Boolean).join(' | ')}]`
        : '';
      return `  { "id": "${t.id}", "title": ${JSON.stringify(t.title)}, "artist": ${JSON.stringify(t.artistName)}${enrichmentStr ? `,${enrichmentStr}` : ''} }`;
    }).join(',\n');

    const userPrompt = [
      `Vibe: ${req.vibe}`,
      `Arc: ${arc.arc}`,
      `Preferred: ${arc.preferred.join(', ')}`,
      `Avoid: ${arc.avoid.join(', ')}`,
      `Session length: ${N} tracks`,
      `Time: ${req.userContext.timeOfDay} on ${req.userContext.dayOfWeek}`,
      '',
      `Pool (${pool.length} tracks):`,
      '[',
      enrichedPool,
      ']',
      '',
      `Return exactly ${N} track IDs in play order as { "ordered": [...] }. JSON only.`,
    ].join('\n');

    return { systemPrompt: SYSTEM_PROMPT, userPrompt };
  }
}
