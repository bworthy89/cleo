export interface LikedTrackInput {
  id: string;
  title: string;
  artistName: string;
  albumTitle: string;
  artworkUrl: string | null;
}

export interface LikedTrack extends LikedTrackInput {
  savedAt: Date;
}

export class AuthRequiredError extends Error {
  constructor() {
    super('Sign-in required to manage liked tracks');
    this.name = 'AuthRequiredError';
  }
}

export const LIKED_TRACKS_CAP = 200;
