import { createMMKV, type MMKV } from 'react-native-mmkv';
import type { Vibe } from '../cleo/fallbacks';
import type { MusicPlaylist } from '../../modules/expo-music-kit';

export const storage: MMKV = createMMKV({ id: 'cleo-storage' });

export const StorageKeys = {
  USER: 'user',
  STATIONS: 'stations',
  RECENTLY_PLAYED: 'recentlyPlayed',
  SESSIONS: 'sessions',
  COLD_OPEN_HISTORY: 'coldOpenHistory',
  CLEO_VIDEO_CACHE: 'cleoVideoCache',
  ENRICHMENT_CACHE: 'enrichmentCache',
  PLAYLISTS_CACHE: 'playlistsCache',
} as const;

export interface UserData {
  name?: string;
  appleMusicAuthorized: boolean;
  createdAt: string;
  defaultVibe?: Vibe;
}

export interface Station {
  id: string;
  name: string;
  playlistId: string;
  defaultVibe: Vibe;
  artworkUrl?: string;
  createdAt: string;
}

export interface RecentlyPlayed {
  trackIds: string[];
  lastUpdated: string;
}

function getObject<T>(key: string): T | undefined {
  const raw = storage.getString(key);
  if (!raw) return undefined;
  return JSON.parse(raw) as T;
}

function setObject<T>(key: string, value: T): void {
  storage.set(key, JSON.stringify(value));
}

// User
export function getUser(): UserData | undefined {
  return getObject<UserData>(StorageKeys.USER);
}

export function setUser(user: UserData): void {
  setObject(StorageKeys.USER, user);
}

// Stations
export function getStations(): Station[] {
  return getObject<Station[]>(StorageKeys.STATIONS) ?? [];
}

export function setStations(stations: Station[]): void {
  setObject(StorageKeys.STATIONS, stations);
}

export function addStation(station: Station): void {
  const existing = getStations();
  setStations([...existing, station]);
}

// Recently Played
export function getRecentlyPlayed(): RecentlyPlayed {
  return getObject<RecentlyPlayed>(StorageKeys.RECENTLY_PLAYED) ?? {
    trackIds: [],
    lastUpdated: new Date().toISOString(),
  };
}

export function addRecentlyPlayedTrack(trackId: string): void {
  const rp = getRecentlyPlayed();
  const updated = [trackId, ...rp.trackIds.filter(id => id !== trackId)].slice(0, 50);
  setObject<RecentlyPlayed>(StorageKeys.RECENTLY_PLAYED, {
    trackIds: updated,
    lastUpdated: new Date().toISOString(),
  });
}

// Playlists Cache
export function getCachedPlaylists(): MusicPlaylist[] | undefined {
  const raw = storage.getString(StorageKeys.PLAYLISTS_CACHE);
  if (!raw) return undefined;
  return JSON.parse(raw) as MusicPlaylist[];
}

export function setCachedPlaylists(playlists: MusicPlaylist[]): void {
  storage.set(StorageKeys.PLAYLISTS_CACHE, JSON.stringify(playlists));
}

// Clear user-facing data on logout (preserves enrichment cache)
export function clearUserData(): void {
  storage.remove(StorageKeys.USER);
  storage.remove(StorageKeys.STATIONS);
  storage.remove(StorageKeys.RECENTLY_PLAYED);
  storage.remove(StorageKeys.SESSIONS);
  storage.remove(StorageKeys.COLD_OPEN_HISTORY);
  storage.remove(StorageKeys.PLAYLISTS_CACHE);
}
