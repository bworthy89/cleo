import type { MusicPlaylist } from '../../modules/expo-music-kit';
import type { CuratedPlaylist } from '../engines/PlaylistCurator';
import type { UserData } from '../services/Storage';

/**
 * Fixture data used when UITEST_MODE is active. Kept in one file so it's
 * easy to tune screenshot content without hunting through subsystem code.
 *
 * Scope: fixtures cover Home (playlists list), AskOnay (pre-seeded curated
 * playlist so the result card is visible on mount), and Profile (fake
 * UserData so onboarding is skipped). The Player screen still requires
 * a real bake — capture that one against the dev server with a real account.
 */

export const UITEST_USER_DATA: UserData = {
  name: 'Screenshot',
  appleMusicAuthorized: true,
  createdAt: '2026-04-01T00:00:00Z',
};

export const UITEST_FIREBASE_USER = {
  uid: 'uitest-user-0001',
  email: 'screenshots@onay.radio',
  displayName: 'Screenshot',
};

export const UITEST_PLAYLISTS: MusicPlaylist[] = [
  { id: 'uitest-pl-late-night', name: 'Late Night Soul',   trackCount: 14 },
  { id: 'uitest-pl-friday',     name: 'Friday Kitchen',    trackCount: 18 },
  { id: 'uitest-pl-sunday',     name: 'Sunday Morning',    trackCount: 22 },
  { id: 'uitest-pl-focus',      name: 'Deep Work',         trackCount: 31 },
  { id: 'uitest-pl-drive',      name: 'Backroads',         trackCount: 17 },
];

/**
 * A CuratedPlaylist shaped result that's pre-seeded into AskOnayScreen in
 * UITEST_MODE, so the screen renders the result card on first paint without
 * needing the curation server round-trip.
 */
export const UITEST_CURATED_PLAYLIST: CuratedPlaylist = {
  playlistTitle: 'After The Rain',
  playlistDescription: 'Warm Rhodes, slow drums, voices right up close.',
  conversationalResponse:
    'Pulled twelve records — the quieter end of the crate. Bill Withers, ' +
    'Roberta Flack, Terry Callier. Start side A, don’t rush it.',
  stance:
    'Easing down, not up. Each track chosen for warmth, not intensity — ' +
    'the kind of set that doesn’t ask anything of you.',
  suggestedVibe: 'lateNight',
  intent: 'mood',
  options: [
    'More Roberta Flack',
    'Take it toward jazz',
    'Drop the tempo',
  ],
  trackIds: Array.from({ length: 12 }, (_, i) => `uitest-track-${i + 1}`),
  tracks: [
    { title: 'Ain’t No Sunshine',      artistName: 'Bill Withers',       albumTitle: 'Just As I Am' },
    { title: 'The First Time',         artistName: 'Roberta Flack',      albumTitle: 'First Take' },
    { title: 'Ordinary Joe',           artistName: 'Terry Callier',      albumTitle: 'What Color Is Love' },
    { title: 'The Look Of Love',       artistName: 'Dusty Springfield',  albumTitle: 'Dusty In Memphis' },
    { title: 'Midnight Blue',          artistName: 'Kenny Burrell',      albumTitle: 'Midnight Blue' },
    { title: 'Summertime',             artistName: 'Billie Holiday',     albumTitle: 'Lady In Satin' },
    { title: 'Feel Like Makin’ Love',  artistName: 'Roberta Flack',      albumTitle: 'Feel Like Makin’ Love' },
    { title: 'Harvest Moon',           artistName: 'Neil Young',         albumTitle: 'Harvest Moon' },
    { title: 'These Eyes',             artistName: 'Jr. Walker',         albumTitle: 'What Does It Take' },
    { title: 'Use Me',                 artistName: 'Bill Withers',       albumTitle: 'Still Bill' },
    { title: 'Lazy Afternoon',         artistName: 'Barbra Streisand',   albumTitle: 'Lazy Afternoon' },
    { title: 'Goodnight Moon',         artistName: 'Shivaree',           albumTitle: 'I Oughtta Give You A Shot' },
  ].map((t, i) => ({
    id: `uitest-track-${i + 1}`,
    title: t.title,
    artistName: t.artistName,
    albumTitle: t.albumTitle,
    duration: 180 + (i % 5) * 15,
    genreNames: ['Soul'],
    trackNumber: i + 1,
    discNumber: 1,
    mbEnriched: false,
    hasRichData: false,
  })),
};
