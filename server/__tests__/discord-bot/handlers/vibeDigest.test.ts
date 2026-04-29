import {
  composeVibeDigest,
  type VibePitch,
  EXCERPT_MAX,
} from '../../../src/discord-bot/handlers/vibeDigest';

function pitch(opts: {
  id: string;
  author: string;
  excerpt: string;
  fires: number;
  createdAt: string;
}): VibePitch {
  return {
    id: opts.id,
    authorUsername: opts.author,
    content: opts.excerpt,
    jumpUrl: `https://discord/${opts.id}`,
    fireReactors: Array.from({ length: opts.fires }, (_, i) => `u${opts.id}-${i}`),
    createdAt: opts.createdAt,
  };
}

describe('composeVibeDigest', () => {
  it('returns null when no pitches received any 🔥', () => {
    const result = composeVibeDigest([
      pitch({ id: '1', author: 'a', excerpt: 'x', fires: 0, createdAt: '2026-04-01' }),
    ]);
    expect(result).toBeNull();
  });

  it('renders top 3 ranked + honorable mentions', () => {
    const pitches = [
      pitch({ id: '1', author: 'a', excerpt: 'rainy sunday', fires: 5, createdAt: '2026-04-22' }),
      pitch({ id: '2', author: 'b', excerpt: 'monday reset', fires: 9, createdAt: '2026-04-22' }),
      pitch({ id: '3', author: 'c', excerpt: 'late commute', fires: 7, createdAt: '2026-04-22' }),
      pitch({ id: '4', author: 'd', excerpt: 'studio day', fires: 2, createdAt: '2026-04-22' }),
      pitch({ id: '5', author: 'e', excerpt: 'no fires', fires: 0, createdAt: '2026-04-22' }),
    ];
    const out = composeVibeDigest(pitches);
    expect(out).not.toBeNull();
    expect(out!).toContain("THIS WEEK'S VIBE PITCHES");
    expect(out!.indexOf('monday reset')).toBeLessThan(out!.indexOf('late commute'));
    expect(out!.indexOf('late commute')).toBeLessThan(out!.indexOf('rainy sunday'));
    expect(out!).toContain('Honorable mentions');
    expect(out!).toContain('@d');
    expect(out!).not.toContain('@e');
  });

  it('ties break older first', () => {
    const pitches = [
      pitch({ id: 'newer', author: 'n', excerpt: 'newer', fires: 3, createdAt: '2026-04-25' }),
      pitch({ id: 'older', author: 'o', excerpt: 'older', fires: 3, createdAt: '2026-04-20' }),
    ];
    const out = composeVibeDigest(pitches);
    expect(out).not.toBeNull();
    expect(out!.indexOf('@o')).toBeLessThan(out!.indexOf('@n'));
  });

  it('truncates excerpts to EXCERPT_MAX', () => {
    const long = 'a'.repeat(EXCERPT_MAX + 200);
    const out = composeVibeDigest([
      pitch({ id: '1', author: 'a', excerpt: long, fires: 1, createdAt: '2026-04-22' }),
    ]);
    expect(out).not.toBeNull();
    expect(out!.includes('a'.repeat(EXCERPT_MAX + 1))).toBe(false);
  });
});
