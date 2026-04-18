export interface AudioFeatures {
  tempo: number;
  valence: number;
  energy: number;
  danceability: number;
  key: number;
  mode: number;
}

const PITCH_CLASSES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

function valenceBand(v: number): string {
  if (v < 0.35) return 'downcast';
  if (v < 0.55) return 'reflective';
  if (v < 0.75) return 'warm';
  return 'bright';
}

function energyBand(e: number): string {
  if (e < 0.5) return 'restrained';
  if (e < 0.75) return 'steady';
  return 'driving';
}

export function formatAudioFeatures(f: AudioFeatures): string {
  const parts: string[] = [];
  if (f.tempo >= 1) parts.push(`${Math.round(f.tempo)} BPM`);
  const pitch = PITCH_CLASSES[f.key] ?? '';
  if (pitch) parts.push(`${pitch} ${f.mode === 1 ? 'major' : 'minor'}`);
  parts.push(`${valenceBand(f.valence)} mood`);
  parts.push(`${energyBand(f.energy)} energy`);
  return parts.join(', ');
}
