import type { EnrichedFacts } from '../services/TrackEnrichmentService';

export interface TrackInfo {
  id?: string;
  title: string;
  artistName: string;
  albumTitle?: string;
  genre?: string;
  genreNames?: string[];
  enrichedFacts?: EnrichedFacts;
  hasRichData?: boolean;
  duration?: number;
}
