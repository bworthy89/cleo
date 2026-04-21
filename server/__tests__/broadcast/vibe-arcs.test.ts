import { VIBE_ARCS } from '@/services/broadcast/vibe-arcs';
import type { Vibe } from '@/services/broadcast/types';

const ALL_VIBES: Vibe[] = [
  'morning', 'focus', 'workout', 'feelGood',
  'lateNight', 'melancholy', 'party',
];

describe('VIBE_ARCS', () => {
  it.each(ALL_VIBES)('has a complete arc for %s', (vibe) => {
    const arc = VIBE_ARCS[vibe];
    expect(arc).toBeDefined();
    expect(arc.vibe).toBe(vibe);
    expect(arc.descriptor.length).toBeGreaterThan(0);
    expect(arc.arc.length).toBeGreaterThan(50);
    expect(arc.preferred.length).toBeGreaterThan(0);
    expect(arc.avoid.length).toBeGreaterThan(0);
  });

  it('covers exactly the 7 vibes', () => {
    expect(Object.keys(VIBE_ARCS).sort()).toEqual([...ALL_VIBES].sort());
  });
});
