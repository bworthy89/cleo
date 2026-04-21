import type { Vibe, BroadcastLength, ManifestTrack } from './types';
import type { LLMCaller } from './SegmentGenerator';
import { VIBE_ARCS } from './vibe-arcs';
import { SequenceCache } from './SequenceCache';
import type { EnrichmentCache } from '../enrichment/EnrichmentCache';
import { repairSequence, removeDuplicates } from './sequence-repair';

const POOL_CAP = 40;
const MAX_LLM_ATTEMPTS = 2;

/**
 * Strip control chars, newlines, role-hijack markers, and backticks from
 * third-party enrichment strings before they flow into the LLM prompt.
 * Mirrors sanitizeForPrompt in SegmentScriptBuilder.
 */
function sanitizeHint(s: string, max: number): string {
  const cleaned = s
    .replace(/[\x00-\x1F\x7F]/g, ' ')
    .replace(/\r?\n/g, ' ')
    .replace(/\b(system|assistant|user)\s*:/gi, '$1')
    .replace(/```+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.length > max ? cleaned.slice(0, max) + '\u2026' : cleaned;
}

const LENGTH_TO_N: Record<BroadcastLength, number> = {
  quick: 5, standard: 9, long: 15,
};

function logResult(
  result: SequenceResult, req: SequenceRequest, poolSize: number,
): void {
  const ids = result.orderedTracks.map(t => t.id);
  const firstId = ids[0] ?? '';
  const lastId = ids[ids.length - 1] ?? '';
  console.log(
    `[LLMTrackSequencer] source=${result.source} vibe=${req.vibe} N=${ids.length} poolSize=${poolSize} firstId=${firstId} lastId=${lastId}`,
  );
}

export interface SequenceRequest {
  pool: ManifestTrack[];
  vibe: Vibe;
  length: BroadcastLength;
  userContext: { timeOfDay: string; dayOfWeek: string };
  /** Required since Task 13. Used by the deterministic sequencer to seed its
   *  PRNG; the LLM path ignores the value. */
  broadcastId: string;
}

export interface SequenceResult {
  orderedTracks: ManifestTrack[];
  featureSlots: number[];
  source: 'cache' | 'llm' | 'fallback' | 'deterministic';
}

/**
 * Structural interface satisfied by both `LLMTrackSequencer` and
 * `DeterministicTrackSequencer`. `BroadcastOrchestrator` depends only on this
 * shape so the two implementations can be swapped via the `SEQUENCER_MODE`
 * env flag.
 */
export interface ITrackSequencer {
  sequence(req: SequenceRequest): Promise<SequenceResult>;
}

const SYSTEM_PROMPT = `You are a radio programmer arranging a broadcast. You receive a pool of tracks and a target arc. Return a JSON array of N track IDs in the order they should play, chosen to best fit the arc using the pool provided.

Preferred and avoid lists are aesthetic hints, not rules. If the pool has few tracks matching preferred, adapt \u2014 find tracks closest to the arc's feel. Never refuse. Your job is to make the best broadcast possible from THESE tracks, whatever they are.

In addition to ordering, nominate transitions for deep-dive treatment. Pick roughly 1 per 4 transitions, rounded up (4 transitions \u2192 1, 8 \u2192 2, 14 \u2192 3-4). Prefer transitions into tracks marked "rich": true (at least 2 enrichment fields) OR transitions at structural moments in the arc \u2014 peak, pivot, resolution. Deep-dive slots get longer, more narrative host commentary; fact bridges get the rest. Return featureSlots as transition slot indices (integers between 1 and N-1 inclusive, where N is the track count).

Hard constraints:
- Output is valid JSON, exactly { "ordered": ["trackId", ...], "featureSlots": [index, ...] }
- Every ID must exist in the pool (no hallucination)
- ordered length is exactly N
- No track appears twice
- featureSlots indices are all in range 1..N-1 inclusive, no duplicates
- Return ONLY the JSON object, no prose before or after`;

export class LLMTrackSequencer implements ITrackSequencer {
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

    const cached = this.cache.get(trackIds, req.vibe, req.length);
    if (cached) {
      const byId = new Map(cappedPool.map(t => [t.id, t]));
      const ordered = cached.ordered
        .map(id => byId.get(id))
        .filter((t): t is ManifestTrack => t !== undefined);
      if (ordered.length === N) {
        const featureSlots = this.fixupFeatureSlots(cached.featureSlots, N);
        const result: SequenceResult = {
          orderedTracks: ordered, featureSlots, source: 'cache',
        };
        logResult(result, req, cappedPool.length);
        return result;
      }
    }

    for (let attempt = 0; attempt < MAX_LLM_ATTEMPTS; attempt++) {
      try {
        const { orderedTracks, featureSlots } =
          await this.attemptSequence(cappedPool, req, N);
        this.cache.set(trackIds, req.vibe, req.length, {
          ordered: orderedTracks.map(t => t.id),
          featureSlots,
        });
        const result: SequenceResult = {
          orderedTracks, featureSlots, source: 'llm',
        };
        logResult(result, req, cappedPool.length);
        return result;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[LLMTrackSequencer] attempt ${attempt + 1} failed: ${msg}`);
      }
    }

    console.warn('[LLMTrackSequencer] falling back to deterministic slice');
    const orderedTracks = cappedPool.slice(0, N);
    const featureSlots = this.fixupFeatureSlots([], N);
    const result: SequenceResult = {
      orderedTracks, featureSlots, source: 'fallback',
    };
    logResult(result, req, cappedPool.length);
    return result;
  }

  private async attemptSequence(
    pool: ManifestTrack[], req: SequenceRequest, N: number,
  ): Promise<{ orderedTracks: ManifestTrack[]; featureSlots: number[] }> {
    const { systemPrompt, userPrompt } = this.buildPrompt(pool, req, N);
    const response = await this.llm.generate({
      systemPrompt, userPrompt, maxTokens: 2048, temperature: 0.6,
    });
    const parsed = this.parseResponse(response.text);
    if (parsed.ordered.length !== N) {
      throw new Error(`wrong length: got ${parsed.ordered.length}, expected ${N}`);
    }
    const byId = new Map(pool.map(t => [t.id, t]));
    const hydrated = parsed.ordered.map(id => {
      const t = byId.get(id);
      if (!t) throw new Error(`hallucinated id: ${id}`);
      return t;
    });
    const deduped = removeDuplicates(hydrated, pool);
    const repaired = repairSequence({ ordered: deduped, pool });
    const orderedTracks = repaired.ordered.slice(0, N);
    const featureSlots = this.fixupFeatureSlots(parsed.featureSlots, N);
    return { orderedTracks, featureSlots };
  }

  private parseResponse(
    raw: string,
  ): { ordered: string[]; featureSlots: number[] } {
    // LLMs sometimes wrap JSON in ```json ... ``` or add preamble. Extract.
    const firstBrace = raw.indexOf('{');
    const lastBrace = raw.lastIndexOf('}');
    if (firstBrace === -1 || lastBrace === -1) {
      throw new Error('no JSON object found');
    }
    const jsonStr = raw.slice(firstBrace, lastBrace + 1);
    const parsed = JSON.parse(jsonStr) as {
      ordered?: unknown; featureSlots?: unknown;
    };
    if (!Array.isArray(parsed.ordered)) {
      throw new Error('ordered is not an array');
    }
    if (!parsed.ordered.every((x): x is string => typeof x === 'string')) {
      throw new Error('ordered contains non-string');
    }
    const rawFeatures = Array.isArray(parsed.featureSlots)
      ? parsed.featureSlots
      : [];
    const featureSlots = rawFeatures.filter(
      (x): x is number => typeof x === 'number' && Number.isInteger(x),
    );
    return { ordered: parsed.ordered, featureSlots };
  }

  private fixupFeatureSlots(raw: number[], N: number): number[] {
    const min = 1;
    const max = N - 1;
    if (max < min) return [];
    const valid = Array.from(
      new Set(raw.filter(i => i >= min && i <= max)),
    ).sort((a, b) => a - b);
    const maxCount = Math.ceil(N / 4);
    const trimmed = valid.slice(0, maxCount);
    if (trimmed.length === 0) {
      // Force at least one deep dive at the middle transition.
      const mid = Math.floor((min + max) / 2);
      return [mid];
    }
    return trimmed;
  }

  private buildPrompt(
    pool: ManifestTrack[], req: SequenceRequest, N: number,
  ): { systemPrompt: string; userPrompt: string } {
    const arc = VIBE_ARCS[req.vibe];
    const enrichedPool = pool.map(t => {
      const enrichment = this.enrichmentCache.get(t.title, t.artistName);
      const parts: string[] = [
        `"id": "${t.id}"`,
        `"title": ${JSON.stringify(t.title)}`,
        `"artist": ${JSON.stringify(t.artistName)}`,
      ];
      if (enrichment) {
        const hintFields: string[] = [
          enrichment.genre ? sanitizeHint(enrichment.genre, 40) : '',
          enrichment.releaseYear ? sanitizeHint(enrichment.releaseYear, 20) : '',
          enrichment.producer ? `prod: ${sanitizeHint(enrichment.producer, 80)}` : '',
          enrichment.wikipediaSummary
            ? `wiki: ${sanitizeHint(enrichment.wikipediaSummary.split('.')[0] ?? '', 160)}`
            : '',
          enrichment.moodTags?.length
            ? `mood: ${sanitizeHint(enrichment.moodTags.join(','), 80)}`
            : '',
        ];
        const nonEmpty = hintFields.filter(h => h.length > 0);
        if (nonEmpty.length) {
          parts.push(`"enrichment": ${JSON.stringify(nonEmpty.join(' | '))}`);
        }
        if (nonEmpty.length >= 2) {
          parts.push(`"rich": true`);
        }
      }
      return `  { ${parts.join(', ')} }`;
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
      `Return exactly ${N} track IDs in play order, plus featureSlots transition indices, as { "ordered": [...], "featureSlots": [...] }. JSON only.`,
    ].join('\n');

    return { systemPrompt: SYSTEM_PROMPT, userPrompt };
  }
}
