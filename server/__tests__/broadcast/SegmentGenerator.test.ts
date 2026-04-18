import { SegmentGenerator } from '@/services/broadcast/SegmentGenerator';
import { makeMockLLM } from '../../__mocks__/llm';
import { makeMockTTS } from '../../__mocks__/tts';
import type { ObjectStorage } from '@/services/storage/ObjectStorage';

const makeStorage = (): ObjectStorage & { puts: Array<[string, Buffer]> } => {
  const puts: Array<[string, Buffer]> = [];
  return {
    puts,
    put: jest.fn(async (key: string, bytes: Buffer) => {
      puts.push([key, bytes]);
      return `https://cdn/${key}`;
    }),
    getAbsolutePath: jest.fn(),
  };
};

describe('SegmentGenerator.generateVariants', () => {
  it('calls LLM then TTS for each prompt and stores bytes', async () => {
    const llm = makeMockLLM('Hello listeners.');
    const tts = makeMockTTS('QUJD');
    const storage = makeStorage();
    const gen = new SegmentGenerator(llm, tts, storage);

    const urls = await gen.generateVariants({
      broadcastId: 'b1',
      slotIndex: 0,
      prompts: [
        { systemPrompt: 's', userPrompt: 'u1', maxTokens: 256 },
        { systemPrompt: 's', userPrompt: 'u2', maxTokens: 256 },
      ],
    });

    expect(urls).toHaveLength(2);
    expect(llm.generate).toHaveBeenCalledTimes(2);
    expect(tts.synthesize).toHaveBeenCalledTimes(2);
    expect(storage.puts).toHaveLength(2);
    const keys = storage.puts.map(([k]) => k).sort();
    expect(keys).toEqual([
      'broadcast/b1/segment/0/v0.mp3',
      'broadcast/b1/segment/0/v1.mp3',
    ]);
    expect(urls[0]).toContain('/v0.mp3');
    expect(urls[1]).toContain('/v1.mp3');
  });

  it('decodes base64 audio into Buffer before storing', async () => {
    const llm = makeMockLLM();
    const tts = makeMockTTS('QUJD');
    const storage = makeStorage();
    const gen = new SegmentGenerator(llm, tts, storage);

    await gen.generateVariants({
      broadcastId: 'b', slotIndex: 2,
      prompts: [{ systemPrompt: 's', userPrompt: 'u', maxTokens: 256 }],
    });

    expect(storage.puts[0][1].toString('utf8')).toBe('ABC');
  });

  it('passes default TTS voice params (stability/style/speed)', async () => {
    const llm = makeMockLLM();
    const tts = makeMockTTS();
    const storage = makeStorage();
    const gen = new SegmentGenerator(llm, tts, storage);

    await gen.generateVariants({
      broadcastId: 'b', slotIndex: 0,
      prompts: [{ systemPrompt: 's', userPrompt: 'u', maxTokens: 256 }],
    });

    const call = (tts.synthesize as jest.Mock).mock.calls[0][0];
    expect(typeof call.stability).toBe('number');
    expect(typeof call.style).toBe('number');
    expect(typeof call.speed).toBe('number');
  });

  it('runs variants in parallel (not serial)', async () => {
    const llm = makeMockLLM();
    let inFlight = 0;
    let maxInFlight = 0;
    (llm.generate as jest.Mock).mockImplementation(async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise(r => setTimeout(r, 10));
      inFlight--;
      return { text: 'x' };
    });
    const tts = makeMockTTS();
    const storage = makeStorage();
    const gen = new SegmentGenerator(llm, tts, storage);

    await gen.generateVariants({
      broadcastId: 'b', slotIndex: 0,
      prompts: [
        { systemPrompt: 's', userPrompt: 'u1', maxTokens: 256 },
        { systemPrompt: 's', userPrompt: 'u2', maxTokens: 256 },
        { systemPrompt: 's', userPrompt: 'u3', maxTokens: 256 },
      ],
    });

    expect(maxInFlight).toBeGreaterThan(1);
  });

  it('propagates LLM errors', async () => {
    const llm = makeMockLLM();
    (llm.generate as jest.Mock).mockRejectedValueOnce(new Error('llm down'));
    const tts = makeMockTTS();
    const storage = makeStorage();
    const gen = new SegmentGenerator(llm, tts, storage);

    await expect(gen.generateVariants({
      broadcastId: 'b', slotIndex: 0,
      prompts: [{ systemPrompt: 's', userPrompt: 'u', maxTokens: 256 }],
    })).rejects.toThrow('llm down');
  });

  it('propagates TTS errors', async () => {
    const llm = makeMockLLM();
    const tts = makeMockTTS();
    (tts.synthesize as jest.Mock).mockRejectedValueOnce(new Error('tts down'));
    const storage = makeStorage();
    const gen = new SegmentGenerator(llm, tts, storage);

    await expect(gen.generateVariants({
      broadcastId: 'b', slotIndex: 0,
      prompts: [{ systemPrompt: 's', userPrompt: 'u', maxTokens: 256 }],
    })).rejects.toThrow('tts down');
  });

  it('phoneticizes ONAY to Oh-nay before TTS synthesis', async () => {
    const llm = makeMockLLM('Hey, this is ONAY. You\u2019re locked in.');
    const tts = makeMockTTS();
    const storage = makeStorage();
    const gen = new SegmentGenerator(llm, tts, storage);

    await gen.generateVariants({
      broadcastId: 'b', slotIndex: 0,
      prompts: [{ systemPrompt: 's', userPrompt: 'u', maxTokens: 256 }],
    });

    const ttsArg = (tts.synthesize as jest.Mock).mock.calls[0][0];
    expect(ttsArg.text).toContain('Oh-nay');
    expect(ttsArg.text).not.toContain('ONAY');
  });
});

describe('phoneticizeHostName', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { phoneticizeHostName } = require('@/services/broadcast/SegmentGenerator');

  it('replaces standalone ONAY with Oh-nay', () => {
    expect(phoneticizeHostName('Hey, this is ONAY.'))
      .toBe('Hey, this is Oh-nay.');
  });

  it('handles multiple occurrences', () => {
    expect(phoneticizeHostName('ONAY here, and that was ONAY signing off.'))
      .toBe('Oh-nay here, and that was Oh-nay signing off.');
  });

  it('does not match substrings like BALONAY or ONAYS', () => {
    expect(phoneticizeHostName('BALONAY sandwich')).toBe('BALONAY sandwich');
    expect(phoneticizeHostName('ONAYS plural form')).toBe('ONAYS plural form');
  });

  it('returns text unchanged when ONAY is absent', () => {
    expect(phoneticizeHostName('just a vibe check')).toBe('just a vibe check');
  });
});

describe('preprocessForTTS — feat./ft. normalization', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { preprocessForTTS } = require('@/services/broadcast/SegmentGenerator');

  it('expands (feat. X) to featuring X and drops parens', () => {
    expect(preprocessForTTS('"Track (feat. Artist)"'))
      .toBe('"Track featuring Artist"');
  });

  it('expands (ft. X) to featuring X', () => {
    expect(preprocessForTTS('"Song (ft. Jay)"'))
      .toBe('"Song featuring Jay"');
  });

  it('handles multi-word artists inside parens', () => {
    expect(preprocessForTTS('"Dreams (feat. Kendrick Lamar)"'))
      .toBe('"Dreams featuring Kendrick Lamar"');
  });

  it('handles case variations (Feat., FEAT., Ft., FT.)', () => {
    expect(preprocessForTTS('"A (Feat. B)"')).toBe('"A featuring B"');
    expect(preprocessForTTS('"A (FEAT. B)"')).toBe('"A featuring B"');
    expect(preprocessForTTS('"A (Ft. B)"')).toBe('"A featuring B"');
    expect(preprocessForTTS('"A (FT. B)"')).toBe('"A featuring B"');
  });

  it('handles missing period after feat/ft', () => {
    expect(preprocessForTTS('"A (feat B)"')).toBe('"A featuring B"');
    expect(preprocessForTTS('"A (ft B)"')).toBe('"A featuring B"');
  });

  it('expands bare feat. outside parens', () => {
    expect(preprocessForTTS('The feat. artist on this one is...'))
      .toBe('The featuring artist on this one is...');
  });

  it('does not touch the English word "feat" (no period)', () => {
    expect(preprocessForTTS('That was quite a feat of engineering.'))
      .toBe('That was quite a feat of engineering.');
  });

  it('composes with host name phoneticization', () => {
    expect(preprocessForTTS('ONAY here with "Track (feat. X)".'))
      .toBe('Oh-nay here with "Track featuring X".');
  });
});
