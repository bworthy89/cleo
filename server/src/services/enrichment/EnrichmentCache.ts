import { promises as fs } from 'fs';
import * as path from 'path';

export interface EnrichmentRecord {
  genre?: string;
  moodTags?: string[];
  releaseYear?: string;
  producer?: string;
  sample?: string;
  lastEnrichedAt: number;
  source: 'genius' | 'musicbrainz' | 'hybrid';
}

interface CacheFile {
  version: number;
  tracks: Record<string, EnrichmentRecord>;
}

function normalizeKey(title: string, artist: string): string {
  const clean = (s: string): string => s
    .toLowerCase()
    .replace(/\(feat\.[^)]*\)/gi, '')
    .replace(/\(remastered[^)]*\)/gi, '')
    .replace(/-\s*deluxe[^|]*/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  return `${clean(title)}|${clean(artist)}`;
}

export class EnrichmentCache {
  private data: Record<string, EnrichmentRecord> = {};
  private loadPromise: Promise<void> | null = null;

  constructor(private readonly filePath: string) {}

  async load(): Promise<void> {
    if (this.loadPromise) return this.loadPromise;
    this.loadPromise = (async () => {
      try {
        await fs.mkdir(path.dirname(this.filePath), { recursive: true });
        const raw = await fs.readFile(this.filePath, 'utf8');
        const parsed = JSON.parse(raw) as CacheFile;
        this.data = parsed.tracks ?? {};
      } catch {
        this.data = {};
      }
    })();
    return this.loadPromise;
  }

  get(title: string, artist: string): EnrichmentRecord | null {
    const key = normalizeKey(title, artist);
    return this.data[key] ?? null;
  }

  async set(title: string, artist: string, record: EnrichmentRecord): Promise<void> {
    const key = normalizeKey(title, artist);
    this.data[key] = record;
    await this.flush();
  }

  private async flush(): Promise<void> {
    const tmp = `${this.filePath}.tmp`;
    const payload: CacheFile = { version: 1, tracks: this.data };
    await fs.writeFile(tmp, JSON.stringify(payload, null, 2), 'utf8');
    await fs.rename(tmp, this.filePath);
  }
}
