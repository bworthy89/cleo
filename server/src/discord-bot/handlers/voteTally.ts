import { COPY } from '../copy';

export const SHIP_THRESHOLD = 10;
export const CANDIDATE_GLYPH = '🎙';
export const EXCERPT_MAX = 80;

export interface VoteMessage {
  id: string;
  authorId: string;
  content: string;
  fireReactors: string[];
}

export function collectVoteCandidates(
  messages: VoteMessage[],
  isProducer: (authorId: string) => boolean
): VoteMessage[] {
  return messages.filter(
    (m) => isProducer(m.authorId) && m.content.includes(CANDIDATE_GLYPH)
  );
}

function firstLineExcerpt(content: string, max: number): string {
  const firstLine = content.split('\n')[0] ?? '';
  const trimmed = firstLine.replace(CANDIDATE_GLYPH, '').trim();
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

export function composeVoteDigest(candidates: VoteMessage[]): string | null {
  if (candidates.length === 0) return null;
  const rows = candidates.map((c) => {
    const count = new Set(c.fireReactors).size;
    const excerpt = firstLineExcerpt(c.content, EXCERPT_MAX);
    return COPY.voteDigestRow(excerpt, count, count >= SHIP_THRESHOLD);
  });
  return [COPY.voteDigestHeader, '', ...rows].join('\n');
}
