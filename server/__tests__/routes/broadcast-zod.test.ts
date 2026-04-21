import { trackSchema } from '../../src/routes/broadcast';

describe('trackSchema ISRC field', () => {
  it('accepts 12-char ISRC', () => {
    const result = trackSchema.safeParse({
      id: '1',
      title: 't',
      artistName: 'a',
      albumTitle: 'b',
      duration: 200,
      isrc: 'USRC17607839',
    });
    expect(result.success).toBe(true);
  });

  it('accepts missing ISRC', () => {
    const result = trackSchema.safeParse({
      id: '1',
      title: 't',
      artistName: 'a',
      albumTitle: 'b',
      duration: 200,
    });
    expect(result.success).toBe(true);
  });

  it('rejects ISRC of wrong length', () => {
    const result = trackSchema.safeParse({
      id: '1',
      title: 't',
      artistName: 'a',
      albumTitle: 'b',
      duration: 200,
      isrc: 'TOO-SHORT',
    });
    expect(result.success).toBe(false);
  });

  it('rejects malformed 12-char ISRC', () => {
    const result = trackSchema.safeParse({
      id: '1',
      title: 't',
      artistName: 'a',
      albumTitle: 'b',
      duration: 200,
      isrc: 'INVALID!@#$%', // 12 chars but fails the ISO 3901 format
    });
    expect(result.success).toBe(false);
  });
});
