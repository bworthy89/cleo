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
 * Replace the stylized name "ONAY" with a phonetic spelling so Cartesia /
 * ElevenLabs pronounce it "Oh-nay" rather than spelling or misreading it.
 * Uses a word-boundary regex so it won't hit unrelated substrings.
 */
export function phoneticizeHostName(script: string): string {
  return script.replace(/\bONAY\b/g, 'Oh-nay');
}

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
      text: phoneticizeHostName(scriptResult.text),
      ...DEFAULT_TTS_PARAMS,
    });
    const key = `broadcast/${broadcastId}/segment/${slotIndex}/v${variant}.mp3`;
    const bytes = Buffer.from(ttsResult.audioContent, 'base64');
    return this.storage.put(key, bytes);
  }
}
