import * as Sentry from '@sentry/node';

export interface BakeStartInput {
  broadcastId: string;
  vibe: string;
  length: 'quick' | 'standard' | 'long';
}

export interface BakeEndInput {
  durationMs: number;
  status: 'completed' | 'failed' | 'aborted';
}

export interface ProviderFallbackInput {
  from: string;
  to: string;
  reason: string;
}

export interface EnrichmentApiTimingInput {
  api: 'reccobeats' | 'deezer' | 'lastfm' | 'genius' | 'musicbrainz' | 'wikipedia';
  durationMs: number;
}

export interface SequencerResultInput {
  vibe: string;
  n: number;
  meanDistance: number;
  poolSize: number;
  featureSourceCounts: Record<string, number>;
}

export interface BakeHandle {
  endSlotZero(durationMs: number): void;
  endBake(input: BakeEndInput): void;
}

/**
 * Single point of contact with Sentry for bake-related telemetry.
 * Confining the Sentry imports here keeps the rest of the codebase
 * mock-free and decouples the choice of telemetry backend.
 */
export class BakeTelemetry {
  startBake(input: BakeStartInput): BakeHandle {
    const span = Sentry.startInactiveSpan({
      name: `bake.${input.length}`,
      op: 'broadcast.bake',
      attributes: {
        'bake.broadcast_id': input.broadcastId,
        'bake.vibe': input.vibe,
        'bake.length': input.length,
      },
    });

    return {
      endSlotZero(durationMs: number) {
        span?.setAttribute('bake.time_to_slot_zero_ms', durationMs);
      },
      endBake(end: BakeEndInput) {
        span?.setAttribute('bake.time_to_completion_ms', end.durationMs);
        span?.setAttribute('bake.status', end.status);
        span?.end();
      },
    };
  }

  recordProviderFallback(input: ProviderFallbackInput): void {
    Sentry.captureMessage('tts.provider-fallback', {
      level: 'warning',
      tags: { from: input.from, to: input.to },
      extra: { reason: input.reason },
    });
  }

  recordEnrichmentApiTiming(input: EnrichmentApiTimingInput): void {
    Sentry.captureMessage('enrichment.api-timing', {
      level: 'info',
      tags: { api: input.api },
      extra: { durationMs: input.durationMs },
    });
  }

  recordSequencerResult(input: SequencerResultInput): void {
    Sentry.captureMessage('sequencer.result', {
      level: 'info',
      tags: { vibe: input.vibe },
      extra: {
        n: input.n,
        meanDistance: input.meanDistance,
        poolSize: input.poolSize,
        featureSourceCounts: input.featureSourceCounts,
      },
    });
  }
}

/** Module-level singleton — consumers import `bakeTelemetry` rather than constructing their own instance. */
export const bakeTelemetry = new BakeTelemetry();
