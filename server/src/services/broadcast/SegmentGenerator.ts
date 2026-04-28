import type { LLMRequest, LLMResponse } from '../../providers/llm/types';
import type { TTSRequest, TTSResponse } from '../../providers/tts/types';
import { applyPronunciations } from '../../providers/tts/pronunciations';
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
 * Artist-name pronunciations (Big K.R.I.T. → "Big Krit", Aminé → "Ahmeenay",
 * …) are applied locally from a shared dictionary (ported from Cartesia's
 * server-side dict) so the self-hosted primary (VoxCPM, no dict API) matches
 * the behavior of the paid providers. Runs before initialism collapse so
 * multi-period entries like "Big K.R.I.T." match before the generic regex
 * strips the dots.
 */
export function preprocessForTTS(text: string): string {
  let out = text;
  // Apply artist pronunciations first (before initialism collapse, which
  // would otherwise mangle multi-period entries into unmatchable forms).
  out = applyPronunciations(out);
  // Normalize curly / typographic apostrophes to straight ASCII. Cartesia's
  // Sonic 3 mis-reads contractions when the apostrophe is U+2019 — "can't"
  // came out as "cont" in testing. Straight ASCII routes through the
  // contraction phoneme path cleanly.
  out = out.replace(/[\u2018\u2019\u02BC\u2032]/g, "'");
  // Curly double quotes → straight ASCII. Character-level tokenizers
  // (VoxCPM today, F5-TTS historically) mishandle U+201C/U+201D
  // consistently; straight quotes are universally safe.
  out = out.replace(/[\u201C\u201D\u2033]/g, '"');
  // Strip markdown-style emphasis wrappers. Gemini occasionally surfaces
  // *word* or **word** as prosody hints, but most TTS engines read them
  // literally — either pronouncing the asterisks or distorting the
  // alignment model, which manifests as exaggerated / theatrical delivery.
  out = out.replace(/\*+([^*\n]+?)\*+/g, '$1');
  // Stray single asterisks (mismatched) — drop them entirely.
  out = out.replace(/\*/g, '');
  // Em-dashes (U+2014) and en-dashes (U+2013) used for pacing in prose
  // get interpreted by TTS models as strong structural breaks — louder
  // pauses than commas, often longer than intended. The LLM writes with
  // them as a style choice; collapse to a simple comma so Chatterbox /
  // Cartesia render a natural clause pause. Also normalize horizontal
  // ellipsis (U+2026) to three dots so TTS doesn't trail off unpredictably.
  out = out.replace(/\s*[\u2014\u2013]\s*/g, ', ');
  out = out.replace(/\u2026/g, '...');
  // Convert unambiguous 24-hour times to spoken 12-hour form. Both client flows
  // (first-listen + home) send timeOfDay in HH:MM, and the LLM often echoes
  // it verbatim into the script. Stock VoxCPM2 mostly read "21:30" naturally
  // as "nine thirty PM"; nano-vllm-voxcpm reads it literally as "twenty-one
  // thirty." Convert 13:00\u201323:59 \u2192 "H:MM PM" and 00:MM \u2192 "12:MM AM". Already-
  // ambiguous 12h forms (1:00\u201312:59) stay as-is so we don't mangle non-time
  // number sequences in song titles, durations, etc.
  out = out.replace(/\b(1[3-9]|2[0-3]):([0-5]\d)\b/g, (_, h, m) => `${parseInt(h, 10) - 12}:${m} PM`);
  out = out.replace(/\b00:([0-5]\d)\b/g, (_, m) => `12:${m} AM`);
  // Collapse single-letter initialisms like K.R.I.T. / U.S.A. / B.I.G. so
  // TTS reads them as one word rather than spelling each letter with a
  // period-pause between. Chatterbox was truncating "K.R.I.T." to "K"
  // and Cartesia spaces the letters out. Keep the trailing period if the
  // initialism ends a sentence.
  out = out.replace(/\b(?:[A-Z]\.){2,}[A-Z]\b\.?/g, (match) => match.replace(/\./g, ''));
  // (feat. X) / (ft. X) / (Feat X) — drop parens, say "featuring X"
  out = out.replace(/\(\s*(?:feat|ft)\.?\s+([^)]+?)\s*\)/gi, 'featuring $1');
  // Bare "feat." / "ft." outside parens — turn into "featuring"
  out = out.replace(/\b(?:feat|ft)\./gi, 'featuring');
  // Host name phonetic. Character-level tokenizers read hyphens in phonetic
  // substitutions as sharp syllable breaks that distort prosody (verified
  // 2026-04-20 via F5-TTS A/B probes; concatenation kept as the default form
  // for VoxCPM since hyphen-free is universally safe). Cartesia/ElevenLabs
  // get the concatenated form too; their own pronunciation dicts were
  // bypassed anyway because we pre-substitute.
  out = out.replace(/\bONAY\b/gi, 'Ohnay');
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
