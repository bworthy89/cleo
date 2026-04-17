import { createMMKV, type MMKV } from 'react-native-mmkv';
import type { MusicPlaylist } from '../../modules/expo-music-kit';
import type { Manifest, Vibe } from '../engines/BroadcastPlayer.types';

export const storage: MMKV = createMMKV({ id: 'cleo-storage' });

export const StorageKeys = {
  USER: 'user',
  PLAYLISTS_CACHE: 'playlistsCache',
  HOST_VOLUME_MIX: 'hostVolumeMix',
  ONAY_SUGGESTION: 'onay_suggestion',
  CURRENT_BROADCAST: 'currentBroadcast',
} as const;

export interface UserData {
  name?: string;
  appleMusicAuthorized: boolean;
  createdAt: string;
  defaultVibe?: Vibe;
}

export function getObject<T>(key: string): T | undefined {
  const raw = storage.getString(key);
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    console.warn(`[Storage] Corrupt data for key "${key}", clearing`);
    storage.remove(key);
    return undefined;
  }
}

export function setObject<T>(key: string, value: T): void {
  storage.set(key, JSON.stringify(value));
}

// User
export function getUser(): UserData | undefined {
  return getObject<UserData>(StorageKeys.USER);
}

export function setUser(user: UserData): void {
  setObject(StorageKeys.USER, user);
}

// Playlists Cache
export function getCachedPlaylists(): MusicPlaylist[] | undefined {
  return getObject<MusicPlaylist[]>(StorageKeys.PLAYLISTS_CACHE);
}

export function setCachedPlaylists(playlists: MusicPlaylist[]): void {
  setObject(StorageKeys.PLAYLISTS_CACHE, playlists);
}

// ONAY Suggestion
export interface OnaySuggestion {
  playlistTitle: string;
  playlistDescription: string;
  conversationalResponse: string;
  tracks: { title: string; artist: string }[];
  suggestedVibe: string;
  generatedAt: number;
  uid: string;
}

export function getOnaySuggestion(uid: string): OnaySuggestion | undefined {
  const suggestion = getObject<OnaySuggestion>(`${StorageKeys.ONAY_SUGGESTION}:${uid}`);
  if (!suggestion) return undefined;
  const SIX_HOURS = 6 * 60 * 60 * 1000;
  if (Date.now() - suggestion.generatedAt > SIX_HOURS) return undefined;
  return suggestion;
}

export function setOnaySuggestion(uid: string, suggestion: OnaySuggestion): void {
  setObject(`${StorageKeys.ONAY_SUGGESTION}:${uid}`, suggestion);
}

// Persisted broadcast manifest — used for resume-after-terminate within the
// in-memory 2h TTL on the server. Cleared on session end.
export function setPersistedBroadcast(manifest: Manifest): void {
  setObject(StorageKeys.CURRENT_BROADCAST, manifest);
}

export function getPersistedBroadcast(): Manifest | undefined {
  return getObject<Manifest>(StorageKeys.CURRENT_BROADCAST);
}

export function clearPersistedBroadcast(): void {
  storage.remove(StorageKeys.CURRENT_BROADCAST);
}

/**
 * Clear user-facing data on logout. Preserves USER so returning users
 * are not re-routed through onboarding.
 */
export function clearUserData(uid?: string): void {
  if (uid) storage.remove(`${StorageKeys.ONAY_SUGGESTION}:${uid}`);
  storage.remove(StorageKeys.PLAYLISTS_CACHE);
  clearPersistedBroadcast();
}
