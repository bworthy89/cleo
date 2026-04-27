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
}
