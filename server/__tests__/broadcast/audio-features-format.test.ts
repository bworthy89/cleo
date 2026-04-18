import { formatAudioFeatures, type AudioFeatures } from '../../src/services/broadcast/audio-features-format';

describe('formatAudioFeatures', () => {
  it('formats tempo, key, valence, energy', () => {
    const f: AudioFeatures = {
      tempo: 72, key: 9, mode: 0, valence: 0.28, energy: 0.4, danceability: 0.3,
    };
    const out = formatAudioFeatures(f);
    expect(out).toContain('72 BPM');
    expect(out).toContain('A minor');
    expect(out).toContain('downcast');
    expect(out).toContain('restrained');
  });

  it('handles major key', () => {
    const f: AudioFeatures = {
      tempo: 120, key: 0, mode: 1, valence: 0.9, energy: 0.9, danceability: 0.8,
    };
    expect(formatAudioFeatures(f)).toContain('C major');
    expect(formatAudioFeatures(f)).toContain('bright');
    expect(formatAudioFeatures(f)).toContain('driving');
  });

  it('omits tempo below 1', () => {
    const f: AudioFeatures = {
      tempo: 0, key: 0, mode: 1, valence: 0.5, energy: 0.5, danceability: 0.5,
    };
    expect(formatAudioFeatures(f)).not.toContain('BPM');
  });

  it('returns non-empty string for all-default inputs', () => {
    const f: AudioFeatures = {
      tempo: 100, key: 5, mode: 1, valence: 0.5, energy: 0.5, danceability: 0.5,
    };
    expect(formatAudioFeatures(f).length).toBeGreaterThan(0);
  });
});
