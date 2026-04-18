import type { EnrichmentFetcher } from './BackgroundEnricher';
import type { EnrichmentRecord } from './EnrichmentCache';
import { GeniusFetcher } from './fetchers/GeniusFetcher';
import { MusicBrainzFetcher } from './fetchers/MusicBrainzFetcher';

export class DefaultEnrichmentFetcher implements EnrichmentFetcher {
  private readonly genius = new GeniusFetcher();
  private readonly mb = new MusicBrainzFetcher();

  async fetchGenius(title: string, artist: string): Promise<Partial<EnrichmentRecord> | null> {
    return this.genius.fetch(title, artist);
  }

  async fetchMusicBrainz(title: string, artist: string): Promise<Partial<EnrichmentRecord> | null> {
    return this.mb.fetch(title, artist);
  }
}
