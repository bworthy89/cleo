import { createHash } from 'node:crypto';

export interface LastFmClientDeps {
  apiKey: string;
  apiSecret: string;
  fetchImpl?: typeof fetch;
}

const SIGN_OMIT = new Set(['api_sig', 'format', 'callback']);

export class LastFmClient {
  private readonly apiKey: string;
  private readonly apiSecret: string;
  private readonly fetchImpl: typeof fetch;

  constructor(deps: LastFmClientDeps) {
    if (!deps.apiKey) throw new Error('LastFmClient: apiKey required');
    if (!deps.apiSecret) throw new Error('LastFmClient: apiSecret required');
    this.apiKey = deps.apiKey;
    this.apiSecret = deps.apiSecret;
    this.fetchImpl = deps.fetchImpl ?? fetch;
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

    const res = await this.fetchImpl('https://ws.audioscrobbler.com/2.0/', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });

    if (!res.ok) throw new Error(`Last.fm getSession HTTP ${res.status}`);
    const data = await res.json() as
      | { session: { name: string; key: string } }
      | { error: number; message: string };

    if ('error' in data) {
      throw new Error(`Last.fm getSession failed: ${data.message} (code ${data.error})`);
    }
    return { name: data.session.name, key: data.session.key };
  }
}
