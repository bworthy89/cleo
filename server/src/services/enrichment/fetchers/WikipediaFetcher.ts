import type { EnrichmentRecord } from '../EnrichmentCache';
import { fetchWithTimeout, DEFAULT_ENRICHMENT_TIMEOUT_MS } from '../http-timeout';

const NOTABLE_SECTIONS = ['Background', 'Recording', 'Composition', 'Release', 'Writing'];
const MAX_NOTABLE_FACTS = 3;

export interface WikipediaFetcherDeps {
  fetchImpl?: typeof fetch;
}

/**
 * Wikipedia enrichment via the REST v1 search + summary + html endpoints.
 * One search call to find the best page, one summary call for the intro,
 * one html call to mine Background / Recording sections. All three are fast
 * and unauthenticated. No rate limiting needed for our scale.
 */
export class WikipediaFetcher {
  constructor(private readonly deps: WikipediaFetcherDeps = {}) {}

  async fetch(title: string, artist: string): Promise<Partial<EnrichmentRecord> | null> {
    try {
      const pageKey = await this.searchBestPage(`${title} ${artist}`);
      if (!pageKey) return null;
      const summary = await this.fetchSummary(pageKey);
      if (!summary) return null;
      const notableFacts = await this.fetchNotableFacts(pageKey);
      const out: Partial<EnrichmentRecord> = {
        wikipediaSummary: summary,
        source: 'wikipedia',
      };
      if (notableFacts.length) out.notableFacts = notableFacts;
      return out;
    } catch {
      return null;
    }
  }

  private async searchBestPage(query: string): Promise<string | null> {
    const url = `https://en.wikipedia.org/w/rest.php/v1/search/title?q=${encodeURIComponent(query)}&limit=1`;
    const res = await fetchWithTimeout(url, {
      timeoutMs: DEFAULT_ENRICHMENT_TIMEOUT_MS,
      fetchImpl: this.deps.fetchImpl,
    });
    if (!res.ok) return null;
    const data = await res.json() as { pages?: Array<{ key: string; title: string }> };
    return data.pages?.[0]?.key ?? null;
  }

  private async fetchSummary(pageKey: string): Promise<string | null> {
    const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(pageKey)}`;
    const res = await fetchWithTimeout(url, {
      timeoutMs: DEFAULT_ENRICHMENT_TIMEOUT_MS,
      fetchImpl: this.deps.fetchImpl,
    });
    if (!res.ok) return null;
    const data = await res.json() as { extract?: string };
    const extract = (data.extract ?? '').trim();
    if (!extract) return null;
    return extract.slice(0, 600);
  }

  private async fetchNotableFacts(pageKey: string): Promise<string[]> {
    const url = `https://en.wikipedia.org/api/rest_v1/page/html/${encodeURIComponent(pageKey)}`;
    const res = await fetchWithTimeout(url, {
      timeoutMs: DEFAULT_ENRICHMENT_TIMEOUT_MS,
      fetchImpl: this.deps.fetchImpl,
    });
    if (!res.ok) return [];
    const html = await res.text();
    const facts: string[] = [];
    for (const section of NOTABLE_SECTIONS) {
      const regex = new RegExp(`<h2[^>]*>\\s*${section}[^<]*<\\/h2>\\s*<p>([^<]+)<`, 'i');
      const match = html.match(regex);
      if (match?.[1]) {
        const text = this.stripHtml(match[1]).trim();
        if (text.length > 30) {
          facts.push(text.slice(0, 400));
          if (facts.length >= MAX_NOTABLE_FACTS) break;
        }
      }
    }
    return facts;
  }

  private stripHtml(s: string): string {
    return s.replace(/<[^>]+>/g, '').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ');
  }
}
