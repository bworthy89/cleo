/**
 * Tests for CleoVoiceEngine
 *
 * Internal functions (parseDeliveryCue, resolveVoiceParams, formatForSpeech, etc.)
 * are tested indirectly through synthesize() by capturing what gets sent to the API.
 */

// Must be declared before imports so jest.mock hoisting works
let lastFetchBody: any = null;

jest.mock('../../src/services/api', () => ({
  authenticatedFetch: jest.fn(async (_url: string, options: any) => {
    lastFetchBody = JSON.parse(options.body);
    return {
      ok: true,
      json: async () => ({ audioContent: 'dGVzdA==' }),
    };
  }),
}));

import { synthesize, playCachedAudio, synthesizeAndPlay } from '../../src/services/CleoVoiceEngine';
import { authenticatedFetch } from '../../src/services/api';
import { playAudioFromBase64 } from '../../modules/expo-music-kit';

beforeEach(() => {
  lastFetchBody = null;
  jest.clearAllMocks();
  // Re-attach the mock implementation after clearAllMocks resets call history
  (authenticatedFetch as jest.Mock).mockImplementation(async (_url: string, options: any) => {
    lastFetchBody = JSON.parse(options.body);
    return {
      ok: true,
      json: async () => ({ audioContent: 'dGVzdA==' }),
    };
  });
});

// ---------------------------------------------------------------------------
// Delivery cue parsing — via synthesize()
// ---------------------------------------------------------------------------

describe('parseDeliveryCue + resolveVoiceParams via synthesize()', () => {
  it('[warm] strips the tag and adjusts stability (chill base 0.30 - 0.05 = 0.25)', async () => {
    await synthesize('[warm] This is a warm delivery.', 'chill');
    expect(lastFetchBody).not.toBeNull();
    // Tag should be stripped — text sent to API must not contain "[warm]"
    expect(lastFetchBody.text).not.toMatch(/\[warm\]/i);
    // stability nudge: chill base 0.30 - 0.05 = 0.25
    expect(lastFetchBody.stability).toBeCloseTo(0.25, 5);
  });

  it('no cue uses base vibe params (chill: stability 0.30, style 0.45)', async () => {
    await synthesize('Plain text, no cue.', 'chill');
    expect(lastFetchBody.stability).toBeCloseTo(0.30, 5);
    expect(lastFetchBody.style).toBeCloseTo(0.45, 5);
    expect(lastFetchBody.speed).toBeCloseTo(0.95, 5);
  });

  it('[hype] increases style (general base 0.55 + 0.10 = 0.65)', async () => {
    await synthesize('[hype] Let\'s go, this track is on fire!', 'general');
    expect(lastFetchBody.style).toBeCloseTo(0.65, 5);
    // stability should be unchanged for hype (no stability nudge)
    expect(lastFetchBody.stability).toBeCloseTo(0.35, 5);
  });

  it('[quiet] reduces speed (general base 1.0 - 0.03 = 0.97)', async () => {
    await synthesize('[quiet] Soft and slow now.', 'general');
    expect(lastFetchBody.speed).toBeCloseTo(0.97, 5);
  });

  it('[playful] increases style and decreases stability', async () => {
    // general base: stability 0.35, style 0.55
    // playful nudge: style +0.05, stability -0.05
    await synthesize('[playful] Ha, you love this one.', 'general');
    expect(lastFetchBody.style).toBeCloseTo(0.60, 5);
    expect(lastFetchBody.stability).toBeCloseTo(0.30, 5);
  });

  it('[reflective] reduces speed and stability (general: speed 1.0-0.02=0.98, stability 0.35-0.05=0.30)', async () => {
    await synthesize('[reflective] Take a moment with this one.', 'general');
    expect(lastFetchBody.speed).toBeCloseTo(0.98, 5);
    expect(lastFetchBody.stability).toBeCloseTo(0.30, 5);
  });

  it('[matter-of-fact] increases stability (general base 0.35 + 0.05 = 0.40)', async () => {
    await synthesize('[matter-of-fact] Straight to the point.', 'general');
    expect(lastFetchBody.stability).toBeCloseTo(0.40, 5);
  });
});

// ---------------------------------------------------------------------------
// formatForSpeech — tested via the text that reaches the API
// ---------------------------------------------------------------------------

describe('formatForSpeech via synthesize()', () => {
  it('strips double quotation marks', async () => {
    await synthesize('"This track hits different."', 'general');
    expect(lastFetchBody.text).not.toMatch(/["""]/);
  });

  it('strips straight double quotation marks (U+0022)', async () => {
    // formatForSpeech regex strips ASCII double-quote characters.
    // Note: the source regex character class contains only ASCII " characters,
    // so only U+0022 is stripped — not Unicode curly quotes U+201C/U+201D.
    await synthesize('"This is beautiful."', 'general');
    expect(lastFetchBody.text).not.toMatch(/"/);
  });

  it('strips stage directions in parentheses like (pause)', async () => {
    await synthesize('Here we go (pause) into the weekend.', 'general');
    expect(lastFetchBody.text).not.toMatch(/\(pause\)/);
  });

  it('strips stage directions in brackets like [beat]', async () => {
    await synthesize('Feel this one. [beat] Really feel it.', 'general');
    expect(lastFetchBody.text).not.toMatch(/\[beat\]/);
  });

  it('preserves abbreviations like "feat."', async () => {
    await synthesize('This track feat. Kendrick Lamar is incredible.', 'general');
    expect(lastFetchBody.text).toMatch(/feat\./);
  });

  it('preserves "vs." abbreviation', async () => {
    await synthesize('Think of it as Drake vs. Kendrick.', 'general');
    expect(lastFetchBody.text).toMatch(/vs\./);
  });

  it('returns non-empty text for a normal segment', async () => {
    await synthesize('Welcome back to the frequency.', 'general');
    expect(lastFetchBody.text.trim().length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// All 12 vibes produce valid voice params
// ---------------------------------------------------------------------------

describe('all 12 vibes produce valid voice params', () => {
  const vibes = [
    'morning', 'chill', 'workout', 'lateNight', 'party', 'focus',
    'feelGood', 'throwback', 'elevated', 'melancholy', 'sunday', 'general',
  ] as const;

  for (const vibe of vibes) {
    it(`vibe "${vibe}" produces stability 0-1, style 0-1, speed 0.5-2`, async () => {
      await synthesize('Test segment for vibe validation.', vibe);
      expect(lastFetchBody).not.toBeNull();
      expect(lastFetchBody.stability).toBeGreaterThanOrEqual(0);
      expect(lastFetchBody.stability).toBeLessThanOrEqual(1);
      expect(lastFetchBody.style).toBeGreaterThanOrEqual(0);
      expect(lastFetchBody.style).toBeLessThanOrEqual(1);
      expect(lastFetchBody.speed).toBeGreaterThanOrEqual(0.5);
      expect(lastFetchBody.speed).toBeLessThanOrEqual(2);
    });
  }
});

// ---------------------------------------------------------------------------
// synthesize() failure cases
// ---------------------------------------------------------------------------

describe('synthesize() failure handling', () => {
  it('returns null on API failure (ok: false)', async () => {
    (authenticatedFetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({}),
    });
    const result = await synthesize('This will fail.', 'general');
    expect(result).toBeNull();
  });

  it('returns null when audioContent is null', async () => {
    (authenticatedFetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ audioContent: null }),
    });
    const result = await synthesize('No audio returned.', 'general');
    expect(result).toBeNull();
  });

  it('returns null when audioContent is missing from response', async () => {
    (authenticatedFetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    });
    const result = await synthesize('No audio field.', 'general');
    expect(result).toBeNull();
  });

  it('returns null when fetch throws', async () => {
    (authenticatedFetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));
    const result = await synthesize('Network failure.', 'general');
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// synthesize() happy path
// ---------------------------------------------------------------------------

describe('synthesize() happy path', () => {
  it('returns base64 audio string on success', async () => {
    const result = await synthesize('Welcome to the frequency.', 'morning');
    expect(result).toBe('dGVzdA==');
  });

  it('uses "general" vibe as default when no vibe is provided', async () => {
    await synthesize('Default vibe test.');
    // general: stability 0.35, style 0.55, speed 1.0
    expect(lastFetchBody.stability).toBeCloseTo(0.35, 5);
    expect(lastFetchBody.style).toBeCloseTo(0.55, 5);
    expect(lastFetchBody.speed).toBeCloseTo(1.0, 5);
  });

  it('calls authenticatedFetch with /synthesize-voice endpoint', async () => {
    await synthesize('Endpoint test.', 'general');
    expect(authenticatedFetch).toHaveBeenCalledWith(
      '/synthesize-voice',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});

// ---------------------------------------------------------------------------
// playCachedAudio()
// ---------------------------------------------------------------------------

describe('playCachedAudio()', () => {
  it('calls playAudioFromBase64 with the provided base64 string', async () => {
    await playCachedAudio('dGVzdA==');
    expect(playAudioFromBase64).toHaveBeenCalledWith('dGVzdA==');
  });
});

// ---------------------------------------------------------------------------
// synthesizeAndPlay()
// ---------------------------------------------------------------------------

describe('synthesizeAndPlay()', () => {
  it('calls playAudioFromBase64 after successful synthesis', async () => {
    await synthesizeAndPlay('Play this immediately.', 'chill');
    expect(playAudioFromBase64).toHaveBeenCalledWith('dGVzdA==');
  });

  it('does not call playAudioFromBase64 when synthesis fails', async () => {
    (authenticatedFetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({}),
    });
    await synthesizeAndPlay('Failing segment.', 'general');
    expect(playAudioFromBase64).not.toHaveBeenCalled();
  });
});
