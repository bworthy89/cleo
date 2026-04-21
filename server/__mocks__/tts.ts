import type { TTSProvider } from '@/providers/tts/types';

export const makeMockTTS = (audioBase64: string = 'TU9DSw=='): TTSProvider => ({
  name: 'mock-tts',
  synthesize: jest.fn(async () => ({ audioContent: audioBase64 })),
  healthCheck: jest.fn(async () => true),
});
