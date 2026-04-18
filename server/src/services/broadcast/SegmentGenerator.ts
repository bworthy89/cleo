import type { LLMRequest, LLMResponse } from '../../providers/llm/types';
import type { TTSRequest, TTSResponse } from '../../providers/tts/types';
import type { ObjectStorage } from '../storage/ObjectStorage';
import type { PromptSet } from './SegmentScriptBuilder';

export interface LLMCaller {
  generate(req: LLMRequest): Promise<LLMResponse>;
}

export interface TTSCaller {
  synthesize(req: TTSRequest): Promise<TTSResponse>;
}

const DEFAULT_TTS_PARAMS = {
  stability: 0.35,
  style: 0.55,
  speed: 1.0,
};

/**
 * Preprocess LLM-generated script text before handing to TTS.
 *
 * Runs in order:
 * 1. (feat. X) / (ft. X) parenthesized features → "featuring X" (drops parens
 *    so prose flows naturally through TTS).
 * 2. Bare "feat." / "ft." outside parens → "featuring".
 * 3. ONAY host name → "Oh-nay" (case-insensitive, word-bounded so "BALONAY"
 *    and "ONAYS" aren't touched).
 *
 * Note: the provider-side pronunciation dictionary (Cartesia's
 * `pronunciation_dict_id`, ElevenLabs' `pronunciation_dictionary_locators`)
 * handles artist/word phonetic overrides; this function handles the
 * structural patterns that dicts can't express cleanly.
 */
export function preprocessForTTS(text: string): string {
  let out = text;
  // Normalize curly / typographic apostrophes to straight ASCII. Cartesia's
  // Sonic 3 mis-reads contractions when the apostrophe is U+2019 — "can't"
  // came out as "cont" in testing. Straight ASCII routes through the
  // contraction phoneme path cleanly.
  out = out.replace(/[\u2018\u2019\u02BC\u2032]/g, "'");
  // (feat. X) / (ft. X) / (Feat X) — drop parens, say "featuring X"
  out = out.replace(/\(\s*(?:feat|ft)\.?\s+([^)]+?)\s*\)/gi, 'featuring $1');
  // Bare "feat." / "ft." outside parens — turn into "featuring"
  out = out.replace(/\b(?:feat|ft)\./gi, 'featuring');
  // Host name phonetic
  out = out.replace(/\bONAY\b/gi, 'Oh-nay');
  return out;
}

/** @deprecated Use preprocessForTTS. Kept as an alias for any external callers. */
export const phoneticizeHostName = preprocessForTTS;

export class SegmentGenerator {
  constructor(
    private readonly llm: LLMCaller,
    private readonly tts: TTSCaller,
    private readonly storage: ObjectStorage,
  ) {}

  async generateVariants(input: {
    broadcastId: string;
    slotIndex: number;
    prompts: PromptSet[];
  }): Promise<string[]> {
    const tasks = input.prompts.map((prompt, v) =>
      this.generateOne(input.broadcastId, input.slotIndex, v, prompt),
    );
    return Promise.all(tasks);
  }

  private async generateOne(
    broadcastId: string,
    slotIndex: number,
    variant: number,
    prompt: PromptSet,
  ): Promise<string> {
    const scriptResult = await this.llm.generate({
      systemPrompt: prompt.systemPrompt,
      userPrompt: prompt.userPrompt,
      maxTokens: prompt.maxTokens,
    });
    const ttsResult = await this.tts.synthesize({
      text: preprocessForTTS(scriptResult.text),
      ...DEFAULT_TTS_PARAMS,
    });
    const key = `broadcast/${broadcastId}/segment/${slotIndex}/v${variant}.mp3`;
    const bytes = Buffer.from(ttsResult.audioContent, 'base64');
    return this.storage.put(key, bytes);
  }
}
