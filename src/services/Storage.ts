import { createMMKV, type MMKV } from 'react-native-mmkv';

export const storage: MMKV = createMMKV({ id: 'cleo-storage' });

export const StorageKeys = {
  USER: 'user',
  STATIONS: 'stations',
  RECENTLY_PLAYED: 'recentlyPlayed',
  SESSIONS: 'sessions',
  COLD_OPEN_HISTORY: 'coldOpenHistory',
  CLEO_VIDEO_CACHE: 'cleoVideoCache',
  ENRICHMENT_CACHE: 'enrichmentCache',
} as const;

export interface UserData {
  name?: string;
  appleMusicAuthorized: boolean;
  createdAt: string;
  defaultVibe?: string;
}

export interface Station {
  id: string;
  name: string;
  playlistId: string;
  defaultVibe: string;
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
