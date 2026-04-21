import { VIBE_ARCS } from '@/services/broadcast/vibe-arcs';
import { VIBE_LIST } from '@/services/broadcast/types';

describe('VIBE_ARCS', () => {
  it.each(VIBE_LIST)('has a complete arc for %s', (vibe) => {
    const arc = VIBE_ARCS[vibe];
    expect(arc).toBeDefined();
    expect(arc.vibe).toBe(vibe);
    expect(arc.descriptor.length).toBeGreaterThan(0);
    expect(arc.arc.length).toBeGreaterThan(50);
    expect(arc.preferred.length).toBeGreaterThan(0);
    expect(arc.avoid.length).toBeGreaterThan(0);
  });

  it('covers exactly the 7 vibes', () => {
    expect(Object.keys(VIBE_ARCS).sort()).toEqual([...VIBE_LIST].sort());
  });
});
