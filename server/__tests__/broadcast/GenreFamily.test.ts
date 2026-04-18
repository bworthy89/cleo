import { normalizeGenreFamily, GENRE_PLAYBOOK, type GenreFamily } from '../../src/services/broadcast/GenreFamily';

describe('normalizeGenreFamily', () => {
  it('returns generic for empty input', () => {
    expect(normalizeGenreFamily()).toBe('generic');
    expect(normalizeGenreFamily('')).toBe('generic');
    expect(normalizeGenreFamily([])).toBe('generic');
  });

  it.each<[string, GenreFamily]>([
    ['jazz', 'jazz'],
    ['post-bop', 'jazz'],
    ['bossa nova', 'jazz'],
    ['hip-hop', 'hipHop'],
    ['hip hop', 'hipHop'],
    ['trap', 'hipHop'],
    ['boom-bap', 'hipHop'],
    ['neo-soul', 'rnb'],
    ['Motown', 'rnb'],
    ['funk', 'rnb'],
    ['R&B', 'rnb'],
    ['rock', 'rock'],
    ['indie', 'rock'],
    ['punk', 'rock'],
    ['deep house', 'electronic'],
    ['EDM', 'electronic'],
    ['ambient', 'electronic'],
    ['folk', 'folk'],
    ['country', 'folk'],
    ['singer-songwriter', 'folk'],
    ['pop', 'pop'],
    ['K-pop', 'pop'],
    ['Afrobeats', 'global'],
    ['reggaeton', 'global'],
    ['gospel', 'gospel'],
    ['praise and worship', 'gospel'],
    ['jazz fusion', 'jazz'],
    ['disco', 'rnb'],
    ['trip-hop', 'electronic'],
    ['trip hop', 'electronic'],
    ['synth-pop', 'electronic'],
    ['synthpop', 'electronic'],
    ['electro-pop', 'electronic'],
    ['electropop', 'electronic'],
    ['drum and bass', 'electronic'],
    ['drum & bass', 'electronic'],
    ["drum'n'bass", 'electronic'],
    ['drum&bass', 'electronic'],
    ['dnb', 'electronic'],
    ['dancehall', 'global'],
    ['ska', 'global'],
    ['blues', 'rnb'],
    ['rhythm and blues', 'rnb'],
  ])('normalizes %s -> %s', (raw, expected) => {
    expect(normalizeGenreFamily(raw)).toBe(expected);
  });

  it('routes gospel before rnb (priority)', () => {
    expect(normalizeGenreFamily('black gospel soul')).toBe('gospel');
  });

  it('accepts string arrays', () => {
    expect(normalizeGenreFamily(['Alternative/Indie', 'Rock'])).toBe('rock');
  });

  it('falls back to generic on unknown', () => {
    expect(normalizeGenreFamily('kosmische')).toBe('generic');
  });
});

describe('GENRE_PLAYBOOK', () => {
  it('has entries for all 10 families', () => {
    const families: GenreFamily[] = [
      'jazz', 'hipHop', 'rnb', 'rock', 'electronic',
      'folk', 'pop', 'global', 'gospel', 'generic',
    ];
    for (const f of families) {
      expect(GENRE_PLAYBOOK[f]).toBeDefined();
      expect(GENRE_PLAYBOOK[f].length).toBeGreaterThan(0);
    }
  });

  it('entries are short (under 400 chars)', () => {
    for (const snippet of Object.values(GENRE_PLAYBOOK)) {
      expect(snippet.length).toBeLessThan(400);
    }
  });
});
