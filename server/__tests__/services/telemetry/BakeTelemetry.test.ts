import * as Sentry from '@sentry/node';
import { BakeTelemetry } from '@/services/telemetry/BakeTelemetry';

jest.mock('@sentry/node', () => ({
  startInactiveSpan: jest.fn(),
  captureMessage: jest.fn(),
}));

describe('BakeTelemetry', () => {
  let telemetry: BakeTelemetry;
  let mockSpan: { end: jest.Mock; setAttribute: jest.Mock };

  beforeEach(() => {
    mockSpan = { end: jest.fn(), setAttribute: jest.fn() };
    (Sentry.startInactiveSpan as jest.Mock).mockReturnValue(mockSpan);
    telemetry = new BakeTelemetry();
  });

  it('endSlotZero records duration as a span attribute', () => {
    const handle = telemetry.startBake({
      broadcastId: 'A3F9K2X1',
      vibe: 'late-night',
      length: 'standard',
    });
    handle.endSlotZero(11500);
    expect(mockSpan.setAttribute).toHaveBeenCalledWith(
      'bake.time_to_slot_zero_ms',
      11500,
    );
  });

  it('endBake closes the span and records total duration', () => {
    const handle = telemetry.startBake({
      broadcastId: 'A3F9K2X1',
      vibe: 'late-night',
      length: 'standard',
    });
    handle.endBake({ durationMs: 42000, status: 'completed' });
    expect(mockSpan.setAttribute).toHaveBeenCalledWith(
      'bake.time_to_completion_ms',
      42000,
    );
    expect(mockSpan.setAttribute).toHaveBeenCalledWith('bake.status', 'completed');
    expect(mockSpan.end).toHaveBeenCalled();
  });

  it('recordProviderFallback emits a structured event', () => {
    telemetry.recordProviderFallback({
      from: 'cosyvoice',
      to: 'f5tts',
      reason: 'synthesize-threw',
    });
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      'tts.provider-fallback',
      expect.objectContaining({
        level: 'warning',
        tags: expect.objectContaining({ from: 'cosyvoice', to: 'f5tts' }),
      }),
    );
  });

  it('recordEnrichmentApiTiming records measurements per API', () => {
    telemetry.recordEnrichmentApiTiming({ api: 'reccobeats', durationMs: 850 });
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      'enrichment.api-timing',
      expect.objectContaining({
        level: 'info',
        tags: { api: 'reccobeats' },
        extra: { durationMs: 850 },
      }),
    );
  });

  it('recordSequencerResult emits a structured event with meanDistance', () => {
    telemetry.recordSequencerResult({
      vibe: 'late-night',
      n: 9,
      meanDistance: 0.42,
      poolSize: 50,
      featureSourceCounts: { reccobeats: 7, deezer: 1, lastfm: 1 },
    });
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      'sequencer.result',
      expect.objectContaining({
        level: 'info',
        tags: expect.objectContaining({ vibe: 'late-night' }),
        extra: expect.objectContaining({ meanDistance: 0.42 }),
      }),
    );
  });

  it('startBake opens a span with bake attributes', () => {
    telemetry.startBake({ broadcastId: 'A3F9K2X1', vibe: 'late-night', length: 'standard' });
    expect(Sentry.startInactiveSpan).toHaveBeenCalledWith(
      expect.objectContaining({
        op: 'broadcast.bake',
        attributes: expect.objectContaining({
          'bake.broadcast_id': 'A3F9K2X1',
          'bake.vibe': 'late-night',
          'bake.length': 'standard',
        }),
      }),
    );
  });

  it('endBake records the failed status on the span', () => {
    const handle = telemetry.startBake({ broadcastId: 'X', vibe: 'chill', length: 'quick' });
    handle.endBake({ durationMs: 5000, status: 'failed' });
    expect(mockSpan.setAttribute).toHaveBeenCalledWith('bake.status', 'failed');
    expect(mockSpan.end).toHaveBeenCalled();
  });

  it('recordProviderFallback puts reason in extra (not tags)', () => {
    telemetry.recordProviderFallback({
      from: 'cosyvoice',
      to: 'f5tts',
      reason: 'synthesize-threw',
    });
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      'tts.provider-fallback',
      expect.objectContaining({
        extra: expect.objectContaining({ reason: 'synthesize-threw' }),
      }),
    );
  });

  it('recordSequencerResult tags poor_fit:true when meanDistance >= 0.5', () => {
    telemetry.recordSequencerResult({
      vibe: 'late-night',
      n: 5,
      meanDistance: 0.62,
      poolSize: 20,
      featureSourceCounts: { reccobeats: 4, defaults: 1 },
    });
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      'sequencer.result',
      expect.objectContaining({
        tags: expect.objectContaining({ poor_fit: 'true' }),
      }),
    );
  });

  it('recordSequencerResult tags poor_fit:false when meanDistance < 0.5', () => {
    telemetry.recordSequencerResult({
      vibe: 'lush',
      n: 9,
      meanDistance: 0.31,
      poolSize: 50,
      featureSourceCounts: { reccobeats: 7, deezer: 2 },
    });
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      'sequencer.result',
      expect.objectContaining({
        tags: expect.objectContaining({ poor_fit: 'false' }),
      }),
    );
  });

  it('recordSequencerResult tags poor_fit:true at exact 0.5 boundary', () => {
    telemetry.recordSequencerResult({
      vibe: 'amber',
      n: 5,
      meanDistance: 0.5,
      poolSize: 20,
      featureSourceCounts: { reccobeats: 5 },
    });
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      'sequencer.result',
      expect.objectContaining({
        tags: expect.objectContaining({ poor_fit: 'true' }),
      }),
    );
  });
});

describe('BakeTelemetry.recordPublishCapHit', () => {
  it('emits a curator.publish-cap-hit warning to Sentry with uid in tags', () => {
    const captureSpy = jest.spyOn(Sentry, 'captureMessage')
      .mockReturnValue('msg-id' as unknown as string);
    try {
      const telemetry = new BakeTelemetry();
      telemetry.recordPublishCapHit({
        uid: 'curator-1',
        current: 3,
        retryAfterMs: 1234,
      });
      expect(captureSpy).toHaveBeenCalledWith(
        'curator.publish-cap-hit',
        expect.objectContaining({
          level: 'warning',
          tags: { uid: 'curator-1' },
          extra: { current: 3, retryAfterMs: 1234 },
        }),
      );
    } finally {
      captureSpy.mockRestore();
    }
  });
});
