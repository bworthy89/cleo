let mockResponse: any = { ok: true, json: async () => ({ text: 'Test segment.' }) };
jest.mock('../../src/services/api', () => ({
  authenticatedFetch: jest.fn(async () => mockResponse),
}));

// Mock static-core to avoid importing large string and any transitive deps
jest.mock('../../src/cleo/static-core', () => ({
  CLEO_STATIC_CORE: 'MOCK_SYSTEM_PROMPT',
}));

import { generateSegment } from '../../src/services/CleoScriptGenerator';
import { authenticatedFetch } from '../../src/services/api';

const mockAuthenticatedFetch = authenticatedFetch as jest.Mock;

function makeContext(overrides?: Partial<any>): any {
  return {
    segmentType: 'song_intro',
    vibe: 'chill',
    deliveryMode: 'pre_song',
    sessionPhase: 'opening',
    currentTrack: { title: 'Test Track', artistName: 'Test Artist' },
    sessionDurationMinutes: 5,
    ...overrides,
  };
}

beforeEach(() => {
  mockResponse = { ok: true, json: async () => ({ text: 'Test segment.' }) };
  jest.clearAllMocks();
});

describe('generateSegment', () => {
  it('returns text from API on successful response', async () => {
    const result = await generateSegment(makeContext());
    expect(result).toBe('Test segment.');
  });

  it('returns a fallback line (non-empty, not API text) on 500 server error', async () => {
    mockResponse = { ok: false, status: 500 };
    const result = await generateSegment(makeContext());
    expect(result).toBeTruthy();
    expect(result).not.toBe('Test segment.');
  });

  it('returns a fallback line on 429 rate limit response', async () => {
    mockResponse = { ok: false, status: 429 };
    const result = await generateSegment(makeContext());
    expect(result).toBeTruthy();
    expect(result).not.toBe('Test segment.');
  });

  it('returns a fallback line when response text is empty', async () => {
    mockResponse = { ok: true, json: async () => ({ text: '' }) };
    const result = await generateSegment(makeContext());
    expect(result).toBeTruthy();
    expect(result).not.toBe('');
  });

  it('returns a fallback line on network error (fetch rejection)', async () => {
    mockAuthenticatedFetch.mockRejectedValueOnce(new Error('Network request failed'));
    const result = await generateSegment(makeContext());
    expect(result).toBeTruthy();
    expect(result).not.toBe('Test segment.');
  });

  it('calls authenticatedFetch with correct URL and body shape', async () => {
    await generateSegment(makeContext());

    expect(mockAuthenticatedFetch).toHaveBeenCalledTimes(1);

    const [url, options] = mockAuthenticatedFetch.mock.calls[0];
    expect(url).toBe('/generate-segment');
    expect(options.method).toBe('POST');

    const body = JSON.parse(options.body);
    expect(body).toHaveProperty('systemPrompt');
    expect(body).toHaveProperty('userPrompt');
    expect(typeof body.systemPrompt).toBe('string');
    expect(typeof body.userPrompt).toBe('string');
    expect(body.systemPrompt.length).toBeGreaterThan(0);
    expect(body.userPrompt.length).toBeGreaterThan(0);
  });
});
