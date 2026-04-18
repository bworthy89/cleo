import type { EnrichmentFetcher } from './BackgroundEnricher';
import type { EnrichmentRecord } from './EnrichmentCache';
import { GeniusFetcher } from './fetchers/GeniusFetcher';
import { MusicBrainzFetcher } from './fetchers/MusicBrainzFetcher';
import { WikipediaFetcher } from './fetchers/WikipediaFetcher';
import { LastFmFetcher } from './fetchers/LastFmFetcher';
import { SpotifyFetcher } from './fetchers/SpotifyFetcher';

export class DefaultEnrichmentFetcher implements EnrichmentFetcher {
  private readonly genius = new GeniusFetcher();
  private readonly mb = new MusicBrainzFetcher();
  private readonly wiki = new WikipediaFetcher();
  private readonly lastfm = new LastFmFetcher();
  private readonly spotify = new SpotifyFetcher();

  fetchGenius(title: string, artist: string): Promise<Partial<EnrichmentRecord> | null> {
    return this.genius.fetch(title, artist);
  }
  fetchMusicBrainz(title: string, artist: string): Promise<Partial<EnrichmentRecord> | null> {
    return this.mb.fetch(title, artist);
  }
  fetchWikipedia(title: string, artist: string): Promise<Partial<EnrichmentRecord> | null> {
    return this.wiki.fetch(title, artist);
  }
  fetchLastFm(title: string, artist: string): Promise<Partial<EnrichmentRecord> | null> {
    return this.lastfm.fetch(title, artist);
  }
  fetchSpotify(title: string, artist: string): Promise<Partial<EnrichmentRecord> | null> {
    return this.spotify.fetch(title, artist);
  }
}
