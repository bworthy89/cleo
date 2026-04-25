import { bakeTelemetry } from '@/services/telemetry/BakeTelemetry';
import { TTSProviderFactory } from '@/providers/tts/index';
import type { TTSProvider } from '@/providers/tts/types';

const STUB_REQUEST = { text: 'hello', speed: 1.0, stability: 0.5, style: 0.5 };

function makeMockProvider(name: string, result: 'success' | 'fail'): TTSProvider {
  return {
    name,
    synthesize: result === 'success'
      ? jest.fn().mockResolvedValue({ audioContent: 'base64audio' })
      : jest.fn().mockRejectedValue(new Error(`${name} boom`)),
    healthCheck: jest.fn().mockResolvedValue(true),
  };
}

describe('TTSProviderFactory telemetry', () => {
  let recordSpy: jest.SpyInstance;

  beforeEach(() => {
    recordSpy = jest.spyOn(bakeTelemetry, 'recordProviderFallback').mockImplementation(() => undefined);
  });

  afterEach(() => {
    recordSpy.mockRestore();
  });

  it('records provider-fallback when primary throws and fallback succeeds', async () => {
    const primary = makeMockProvider('cosyvoice', 'fail');
    const fallback = makeMockProvider('f5tts', 'success');
    const tertiary = makeMockProvider('cartesia', 'success');

    const factory = TTSProviderFactory.makeWithProviders(primary, fallback, tertiary);

    await factory.synthesize(STUB_REQUEST);

    expect(recordSpy).toHaveBeenCalledTimes(1);
    expect(recordSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'cosyvoice',
        to: 'f5tts',
        reason: expect.stringContaining('boom'),
      }),
    );
  });

  it('records two fallback events when primary and fallback both throw', async () => {
    const primary = makeMockProvider('cosyvoice', 'fail');
    const fallback = makeMockProvider('f5tts', 'fail');
    const tertiary = makeMockProvider('cartesia', 'success');

    const factory = TTSProviderFactory.makeWithProviders(primary, fallback, tertiary);

    await factory.synthesize(STUB_REQUEST);

    expect(recordSpy).toHaveBeenCalledTimes(2);
    expect(recordSpy).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ from: 'cosyvoice', to: 'f5tts' }),
    );
    expect(recordSpy).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        from: 'f5tts',
        to: 'cartesia',
        reason: expect.stringContaining('boom'),
      }),
    );
  });

  it('records provider-fallback when active provider is fallback and it throws', async () => {
    // Simulate primaryHealthy=false so fallback is the active starting provider.
    const primary = makeMockProvider('cosyvoice', 'success');
    const fallback = makeMockProvider('f5tts', 'fail');
    const tertiary = makeMockProvider('cartesia', 'success');

    const factory = TTSProviderFactory.makeWithProviders(primary, fallback, tertiary);
    // Force primary to be unhealthy so fallback becomes the active provider.
    (factory as unknown as Record<string, unknown>)['primaryHealthy'] = false;

    await factory.synthesize(STUB_REQUEST);

    expect(recordSpy).toHaveBeenCalledTimes(1);
    expect(recordSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'f5tts',
        to: 'cartesia',
        reason: expect.stringContaining('boom'),
      }),
    );
  });

  it('does not record a fallback event when primary succeeds', async () => {
    const primary = makeMockProvider('cosyvoice', 'success');
    const fallback = makeMockProvider('f5tts', 'success');
    const tertiary = makeMockProvider('cartesia', 'success');

    const factory = TTSProviderFactory.makeWithProviders(primary, fallback, tertiary);

    await factory.synthesize(STUB_REQUEST);

    expect(recordSpy).not.toHaveBeenCalled();
  });
});
