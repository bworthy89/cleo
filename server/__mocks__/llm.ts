import type { LLMProvider } from '@/providers/llm/types';

export const makeMockLLM = (response: string = 'Mock script.'): LLMProvider => ({
  name: 'mock-llm',
  generate: jest.fn(async () => ({ text: response })),
  healthCheck: jest.fn(async () => true),
});
