import * as Sentry from '@sentry/node';
import { BakeTelemetry } from '@/services/telemetry/BakeTelemetry';

jest.mock('@sentry/node', () => ({
  startInactiveSpan: jest.fn(),
  captureMessage: jest.fn(),
  setMeasurement: jest.fn(),
}));

describe('BakeTelemetry', () => {
  let telemetry: BakeTelemetry;
  let mockSpan: { end: jest.Mock; setAttribute: jest.Mock };

  beforeEach(() => {
    mockSpan = { end: jest.fn(), setAttribute: jest.fn() };
    (Sentry.startInactiveSpan as jest.Mock).mockReturnValue(mockSpan);
    telemetry = new BakeTelemetry();
  });

  it('startBake returns a handle whose endSlotZero records a measurement', () => {
    const handle = telemetry.startBake({
      broadcastId: 'A3F9K2X1',
      vibe: 'late-night',
      length: 'standard',
    });
    handle.endSlotZero(11500);
    expect(Sentry.setMeasurement).toHaveBeenCalledWith(
      'bake.time_to_slot_zero_ms',
      11500,
      'millisecond',
    );
  });

  it('endBake closes the span and records total duration', () => {
    const handle = telemetry.startBake({
      broadcastId: 'A3F9K2X1',
      vibe: 'late-night',
      length: 'standard',
    });
    handle.endBake({ durationMs: 42000, status: 'completed' });
    expect(Sentry.setMeasurement).toHaveBeenCalledWith(
      'bake.time_to_completion_ms',
      42000,
      'millisecond',
    );
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
    expect(Sentry.setMeasurement).toHaveBeenCalledWith(
      'enrichment.reccobeats_ms',
      850,
      'millisecond',
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
});
