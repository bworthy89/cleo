import { COPY } from '../copy';

export const EXCERPT_MAX = 100;

export interface VibePitch {
  id: string;
  authorUsername: string;
  content: string;
  jumpUrl: string;
  fireReactors: string[];
  createdAt: string;
}

interface Scored {
  pitch: VibePitch;
  count: number;
}

function excerpt(content: string): string {
  const firstLine = content.split('\n')[0] ?? '';
  if (firstLine.length <= EXCERPT_MAX) return firstLine;
  // Slice to EXCERPT_MAX - 1 then append the ellipsis so total length stays ≤ EXCERPT_MAX.
  return firstLine.slice(0, EXCERPT_MAX - 1) + '…';
}

function rank(a: Scored, b: Scored): number {
  if (b.count !== a.count) return b.count - a.count;
  return a.pitch.createdAt.localeCompare(b.pitch.createdAt);
}

export function composeVibeDigest(pitches: VibePitch[]): string | null {
  const scored: Scored[] = pitches.map((p) => ({
    pitch: p,
    count: new Set(p.fireReactors).size,
  }));
  const withFires = scored.filter((s) => s.count > 0);
  if (withFires.length === 0) return null;

  const sorted = [...withFires].sort(rank);
  const top = sorted.slice(0, 3);
  const honorable = sorted.slice(3);

  const lines = [COPY.vibeDigestHeader, ''];
  top.forEach((s, i) => {
    lines.push(
      COPY.vibeDigestTopRow(
        i + 1,
        s.count,
        s.pitch.authorUsername,
        excerpt(s.pitch.content),
        s.pitch.jumpUrl
      )
    );
  });
  if (honorable.length > 0) {
    lines.push(COPY.vibeDigestHonorableHeader);
    honorable.forEach((s) => {
      lines.push(COPY.vibeDigestHonorableRow(s.pitch.authorUsername, excerpt(s.pitch.content)));
    });
  }
  return lines.join('\n');
}
