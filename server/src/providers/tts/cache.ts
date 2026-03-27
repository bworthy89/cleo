import { createHash } from 'crypto';
import { mkdir, readFile, writeFile, rename, unlink, stat } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import { TTSProvider, TTSRequest, TTSResponse } from './types';

export class CachingTTSProvider implements TTSProvider {
  readonly name: string;
  private inner: TTSProvider;
  private cacheDir: string;
  private ready: Promise<void>;

  constructor(inner: TTSProvider) {
    this.inner = inner;
    this.name = `cached:${inner.name}`;
    this.cacheDir = process.env.TTS_CACHE_DIR || join(homedir(), '.cache', 'cleo-tts');
    this.ready = mkdir(this.cacheDir, { recursive: true }).then(() => {});
  }

  // Cache key includes voice ID and model ID so changing either
  // automatically invalidates stale entries. stability and style are
  // excluded intentionally — they affect tone subtly, not content,
  // and including them would fragment the cache on vibe changes.
  private getCacheKey(request: TTSRequest): string {
    const voiceId = process.env.CARTESIA_VOICE_ID || '';
    const modelId = process.env.CARTESIA_MODEL_ID || 'sonic-3';
    const input = `${request.text}|${request.speed}|${voiceId}|${modelId}`;
    return createHash('sha256').update(input).digest('hex');
  }

  async synthesize(request: TTSRequest): Promise<TTSResponse> {
    await this.ready;
    const hash = this.getCacheKey(request);
    const cachePath = join(this.cacheDir, hash);

    // Try cache read
    try {
      const fileInfo = await stat(cachePath);
      if (fileInfo.size > 0) {
        try {
          const audioContent = await readFile(cachePath, 'utf-8');
          console.log(`[TTS:cache] HIT ${hash.slice(0, 8)}`);
          return { audioContent };
        } catch {
          // Corrupt file — delete and fall through to re-synthesize
          console.warn(`[TTS:cache] Corrupt file ${hash.slice(0, 8)}, deleting`);
          await unlink(cachePath).catch(() => {});
        }
      } else {
        // Empty file — clean up
        await unlink(cachePath).catch(() => {});
      }
    } catch {
      // File doesn't exist — cache miss, fall through
    }

    // Cache miss — synthesize
    console.log(`[TTS:cache] MISS ${hash.slice(0, 8)} — synthesizing`);
    const result = await this.inner.synthesize(request);

    // Atomic write: temp file then rename
    const tmpPath = `${cachePath}.tmp.${process.pid}`;
    try {
      await writeFile(tmpPath, result.audioContent, 'utf-8');
      await rename(tmpPath, cachePath);
    } catch (err) {
      console.warn(`[TTS:cache] Write failed:`, (err as Error).message);
      await unlink(tmpPath).catch(() => {});
    }

    return result;
  }

  async healthCheck(): Promise<boolean> {
    return this.inner.healthCheck();
  }
}
