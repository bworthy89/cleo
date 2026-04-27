import { createHash } from 'node:crypto';
import type { ScrobbleTrack, LastFmResult } from './types';

export interface LastFmClientDeps {
  apiKey: string;
  apiSecret: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

const SIGN_OMIT = new Set(['api_sig', 'format', 'callback']);

export class LastFmClient {
  private readonly apiKey: string;
  private readonly apiSecret: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(deps: LastFmClientDeps) {
    if (!deps.apiKey) throw new Error('LastFmClient: apiKey required');
    if (!deps.apiSecret) throw new Error('LastFmClient: apiSecret required');
    this.apiKey = deps.apiKey;
    this.apiSecret = deps.apiSecret;
    this.fetchImpl = deps.fetchImpl ?? fetch;
    this.timeoutMs = deps.timeoutMs ?? 15_000;
  }

  signRequest(params: Record<string, string>): string {
    const keys = Object.keys(params).filter(k => !SIGN_OMIT.has(k)).sort();
    let concat = '';
    for (const k of keys) concat += k + params[k];
    concat += this.apiSecret;
    return createHash('md5').update(concat).digest('hex');
  }

  async getSession(token: string): Promise<{ key: string; name: string }> {
    const params: Record<string, string> = {
      method: 'auth.getSession',
      api_key: this.apiKey,
      token,
    };
    const sig = this.signRequest(params);
    const body = new URLSearchParams({ ...params, api_sig: sig, format: 'json' });

    let res: Response;
    try {
      res = await this.fetchImpl('https://ws.audioscrobbler.com/2.0/', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      if ((err as Error)?.name === 'TimeoutError') {
        throw new Error('Last.fm getSession timed out');
      }
      throw err;
    }

    if (!res.ok) throw new Error(`Last.fm getSession HTTP ${res.status}`);
    const data = await res.json() as
      | { session: { name: string; key: string } }
      | { error: number; message: string };

    if ('error' in data) {
      throw new Error(`Last.fm getSession failed: ${data.message} (code ${data.error})`);
    }
    return { name: data.session.name, key: data.session.key };
  }

  async updateNowPlaying(sessionKey: string, t: ScrobbleTrack): Promise<LastFmResult> {
    const params: Record<string, string> = {
      method: 'track.updateNowPlaying',
      api_key: this.apiKey,
      artist: t.artistName,
      track: t.title,
      duration: String(Math.round(t.duration)),
      sk: sessionKey,
    };
    if (t.albumTitle) params.album = t.albumTitle;
    return this.signedPost(params);
  }

  async scrobble(sessionKey: string, t: ScrobbleTrack): Promise<LastFmResult> {
    if (typeof t.startedAt !== 'number') {
      throw new Error('LastFmClient.scrobble: startedAt required');
    }
    const params: Record<string, string> = {
      method: 'track.scrobble',
      api_key: this.apiKey,
      artist: t.artistName,
      track: t.title,
      duration: String(Math.round(t.duration)),
      timestamp: String(t.startedAt),
      sk: sessionKey,
    };
    if (t.albumTitle) params.album = t.albumTitle;
    return this.signedPost(params);
  }

  private async signedPost(params: Record<string, string>): Promise<LastFmResult> {
    const sig = this.signRequest(params);
    const body = new URLSearchParams({ ...params, api_sig: sig, format: 'json' });
    let res: Response;
    try {
      res = await this.fetchImpl('https://ws.audioscrobbler.com/2.0/', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      const msg = (err as Error)?.name === 'TimeoutError' ? 'timeout' : `network: ${(err as Error)?.message ?? 'unknown'}`;
      return { ok: false, errorCode: -1, errorMessage: msg };
    }
    if (!res.ok) {
      return { ok: false, errorCode: -1, errorMessage: `HTTP ${res.status}` };
    }
    const data = await res.json() as { error?: number; message?: string };
    if (typeof data.error === 'number') {
      return { ok: false, errorCode: data.error, errorMessage: data.message ?? 'unknown' };
    }
    return { ok: true };
  }
}
