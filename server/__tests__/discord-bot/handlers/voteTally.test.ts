import {
  collectVoteCandidates,
  composeVoteDigest,
  SHIP_THRESHOLD,
} from '../../../src/discord-bot/handlers/voteTally';

interface TestMsg {
  id: string;
  authorId: string;
  content: string;
  fireReactors: string[];
}

describe('collectVoteCandidates', () => {
  it('keeps only Producer-role-authored messages containing 🎙', () => {
    const producers = new Set(['pro1', 'pro2']);
    const isProducer = (id: string) => producers.has(id);
    const messages: TestMsg[] = [
      { id: '1', authorId: 'pro1', content: '🎙 a candidate', fireReactors: [] },
      { id: '2', authorId: 'pro1', content: 'no glyph here', fireReactors: [] },
      { id: '3', authorId: 'tester', content: '🎙 not from producer', fireReactors: [] },
      { id: '4', authorId: 'pro2', content: '🎙 another', fireReactors: [] },
    ];
    const result = collectVoteCandidates(messages, isProducer);
    expect(result.map((m) => m.id)).toEqual(['1', '4']);
  });
});

describe('composeVoteDigest', () => {
  function cand(id: string, excerpt: string, count: number) {
    return {
      id,
      authorId: 'pro',
      content: `🎙 ${excerpt}\nrest`,
      fireReactors: Array.from({ length: count }, (_, i) => `u${id}-${i}`),
    };
  }

  it('marks SHIP IT when count >= threshold and no ship below', () => {
    const digest = composeVoteDigest([
      cand('1', 'Friday Jazz', SHIP_THRESHOLD),
      cand('2', 'Workout', SHIP_THRESHOLD - 1),
    ]);
    expect(digest).toContain("LAST NIGHT'S VOTES");
    expect(digest).toMatch(/Friday Jazz.*🔥 — SHIP IT/);
    expect(digest).toMatch(/Workout.*🔥 — no ship/);
  });

  it('returns null when there are no candidates', () => {
    expect(composeVoteDigest([])).toBeNull();
  });

  it('truncates excerpts to 80 chars', () => {
    const long = 'a'.repeat(120);
    const digest = composeVoteDigest([cand('1', long, 1)]);
    expect(digest).not.toBeNull();
    expect(digest!.includes('a'.repeat(81))).toBe(false);
  });
});
