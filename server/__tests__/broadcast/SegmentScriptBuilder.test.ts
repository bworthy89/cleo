import { buildSegmentPrompts } from '@/services/broadcast/SegmentScriptBuilder';
import type { Manifest } from '@/services/broadcast/types';

const makeManifest = (): Manifest => ({
  broadcastId: 'b1', userId: 'u1', playlistId: 'p1',
  vibe: 'lateNight', length: 'quick', createdAt: Date.now(),
  tracks: [
    { id: 't0', title: 'Nikes', artistName: 'Frank Ocean', albumTitle: 'Blonde', duration: 314 },
    { id: 't1', title: 'Pyramids', artistName: 'Frank Ocean', albumTitle: 'Channel Orange', duration: 600 },
    { id: 't2', title: 'Redbone', artistName: 'Childish Gambino', albumTitle: 'Awaken, My Love!', duration: 306 },
  ],
  segmentSlots: [
    { index: 0, kind: 'cold_open', beforeTrackId: 't0', variantCount: 3, status: 'pending' },
    { index: 1, kind: 'transition', afterTrackId: 't0', beforeTrackId: 't1', variantCount: 1, status: 'pending' },
    { index: 2, kind: 'transition', afterTrackId: 't1', beforeTrackId: 't2', variantCount: 1, status: 'pending' },
    { index: 3, kind: 'sign_off', afterTrackId: 't2', variantCount: 1, status: 'pending' },
  ],
});

const ctx = {
  timeOfDay: '20:47', dayOfWeek: 'Thursday', firstTimeUser: false,
  lastSessionSummary: 'left off with Kendrick',
  tracksRecentlyPlayed: [], listenerName: 'Kari',
};

describe('buildSegmentPrompts', () => {
  it('returns variantCount prompt sets for cold_open', () => {
    const m = makeManifest();
    const prompts = buildSegmentPrompts(m.segmentSlots[0], m, ctx);
    expect(prompts).toHaveLength(3);
  });

  it('references the first track in cold_open user prompt', () => {
    const m = makeManifest();
    const [prompt] = buildSegmentPrompts(m.segmentSlots[0], m, ctx);
    expect(prompt.userPrompt).toContain('Nikes');
    expect(prompt.userPrompt).toContain('Frank Ocean');
  });

  it('mentions day/time in cold_open to enable "live" feel', () => {
    const m = makeManifest();
    const [prompt] = buildSegmentPrompts(m.segmentSlots[0], m, ctx);
    expect(prompt.userPrompt).toContain('Thursday');
    expect(prompt.userPrompt).toContain('20:47');
  });

  it('references both outgoing and incoming tracks in transition', () => {
    const m = makeManifest();
    const [prompt] = buildSegmentPrompts(m.segmentSlots[1], m, ctx);
    expect(prompt.userPrompt).toContain('Nikes');
    expect(prompt.userPrompt).toContain('Pyramids');
  });

  it('references the last track in sign_off', () => {
    const m = makeManifest();
    const [prompt] = buildSegmentPrompts(m.segmentSlots[3], m, ctx);
    expect(prompt.userPrompt).toContain('Redbone');
  });

  it('returns exactly 1 variant for transition and sign_off', () => {
    const m = makeManifest();
    expect(buildSegmentPrompts(m.segmentSlots[1], m, ctx)).toHaveLength(1);
    expect(buildSegmentPrompts(m.segmentSlots[3], m, ctx)).toHaveLength(1);
  });

  it('includes the vibe in system prompt', () => {
    const m = makeManifest();
    const [prompt] = buildSegmentPrompts(m.segmentSlots[0], m, ctx);
    expect(prompt.systemPrompt.toLowerCase()).toContain('late');
  });
});
