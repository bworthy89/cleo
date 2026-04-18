/**
 * Quick TTS smoke test against whichever provider is primary per TTS_PRIMARY.
 *
 *   npx tsx scripts/test-tts.ts "Hello from ONAY, can't wait to spin this one for you tonight."
 *
 * Writes the resulting audio to /tmp/tts-test.wav so you can play it.
 * Useful for dialing in Chatterbox params without running a full bake.
 */
import 'dotenv/config';
import { ttsProvider } from '../src/providers/tts';
import { preprocessForTTS } from '../src/services/broadcast/SegmentGenerator';
import { promises as fs } from 'fs';

async function main(): Promise<void> {
  const raw = process.argv[2] ?? 'Hello, this is a Chatterbox test.';
  const text = preprocessForTTS(raw);
  console.log(`[test-tts] provider status:`, JSON.stringify(ttsProvider.getStatus(), null, 2));
  console.log(`[test-tts] raw input:       ${raw.substring(0, 100)}`);
  console.log(`[test-tts] post-preprocess: ${text.substring(0, 100)}`);
  const start = Date.now();
  const result = await ttsProvider.synthesize({
    text,
    stability: 0.35,
    style: 0.55,
    speed: 1.0,
  });
  const elapsed = Date.now() - start;
  const bytes = Buffer.from(result.audioContent, 'base64');
  const outPath = '/tmp/tts-test.wav';
  await fs.writeFile(outPath, bytes);
  console.log(`[test-tts] ${bytes.byteLength} bytes in ${elapsed}ms`);
  console.log(`[test-tts] wrote ${outPath}`);
  console.log(`[test-tts] play: afplay ${outPath}`);
  ttsProvider.destroy();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
