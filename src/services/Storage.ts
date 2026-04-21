import { createMMKV, type MMKV } from 'react-native-mmkv';
import type { MusicPlaylist } from '../../modules/expo-music-kit';
import type { Manifest } from '../engines/BroadcastPlayer.types';

export const storage: MMKV = createMMKV({ id: 'cleo-storage' });

export const StorageKeys = {
  USER: 'user',
  PLAYLISTS_CACHE: 'playlistsCache',
  HOST_VOLUME_MIX: 'hostVolumeMix',
  ONAY_SUGGESTION: 'onay_suggestion',
  CURRENT_BROADCAST: 'currentBroadcast',
  BROADCAST_HISTORY: 'broadcast_history',
  NOTIF_TONIGHT_READY: 'notif_tonight_ready',
  NOTIF_MORNING_RECAP: 'notif_morning_recap',
} as const;

export const BROADCAST_HISTORY_RETENTION_MS = 24 * 60 * 60 * 1000; // 24h
export const BROADCAST_HISTORY_MAX_ENTRIES = 10;

export interface UserData {
  name?: string;
  appleMusicAuthorized: boolean;
  createdAt: string;
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

export interface PersistedBroadcast {
  manifest: Manifest;
  /** -1 = no track started yet; 0..N-1 = last track the player entered. */
  trackCursor: number;
  /** ms since epoch — debugging / future freshness heuristics. */
  updatedAt: number;
}

function isPersistedBroadcast(v: unknown): v is PersistedBroadcast {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.manifest === 'object' && o.manifest !== null && !Array.isArray(o.manifest) &&
    typeof o.trackCursor === 'number' &&
    typeof o.updatedAt === 'number'
  );
}

/** Persisted broadcast cursor — used for mid-session resume within the
 *  in-memory 2h TTL on the server. Cleared on session end. */
export function setPersistedBroadcast(rec: PersistedBroadcast): void {
  setObject(StorageKeys.CURRENT_BROADCAST, rec);
}

/** Returns the persisted record, or undefined if missing / corrupt /
 *  legacy shape. Clears the MMKV key on shape mismatch so the user
 *  doesn't see a stale "resume" offer after an upgrade. */
export function getPersistedBroadcast(): PersistedBroadcast | undefined {
  const raw = getObject<unknown>(StorageKeys.CURRENT_BROADCAST);
  if (raw === undefined) return undefined;
  if (!isPersistedBroadcast(raw)) {
    console.warn('[Storage] persisted broadcast has legacy/corrupt shape, clearing');
    clearPersistedBroadcast();
    return undefined;
  }
  return raw;
}

export function clearPersistedBroadcast(): void {
  storage.remove(StorageKeys.CURRENT_BROADCAST);
}

/** Read-modify-write: updates only the cursor, preserves manifest and
 *  updatedAt. No-op when no record exists — defensive, should not be
 *  called before setPersistedBroadcast has seeded the record. */
export function updatePersistedCursor(trackIndex: number): void {
  const rec = getPersistedBroadcast();
  if (!rec) return;
  setPersistedBroadcast({ ...rec, trackCursor: trackIndex });
}

/**
 * Clear user-facing data on logout. Preserves USER so returning users
 * are not re-routed through onboarding.
 */
export function clearUserData(uid?: string): void {
  if (uid) storage.remove(`${StorageKeys.ONAY_SUGGESTION}:${uid}`);
  storage.remove(StorageKeys.PLAYLISTS_CACHE);
  clearPersistedBroadcast();
  storage.remove(StorageKeys.BROADCAST_HISTORY);
}

// Broadcast history — last N completed/in-flight broadcasts the user kicked
// off, so they can see and replay them from the home screen. Replay is free
// (zero LLM/TTS cost) because we reuse the stored manifest and R2 URLs.
export interface BroadcastHistoryEntry {
  manifest: Manifest;
  firstSegmentUrls: string[];
  createdAt: number; // ms since epoch
}

/**
 * Prepend a broadcast to the history list. Dedupes by broadcastId so
 * re-calling with the same manifest (e.g. on re-start) updates in place
 * rather than creating a duplicate. Caps the list at MAX_ENTRIES; oldest
 * entries drop off the tail.
 */
export function addBroadcastToHistory(
  manifest: Manifest,
  firstSegmentUrls: string[],
): void {
  const existing = getObject<BroadcastHistoryEntry[]>(StorageKeys.BROADCAST_HISTORY) ?? [];
  const withoutDupe = existing.filter(
    e => e.manifest.broadcastId !== manifest.broadcastId,
  );
  const entry: BroadcastHistoryEntry = {
    manifest, firstSegmentUrls, createdAt: Date.now(),
  };
  const next = [entry, ...withoutDupe].slice(0, BROADCAST_HISTORY_MAX_ENTRIES);
  setObject(StorageKeys.BROADCAST_HISTORY, next);
}

/**
 * Return history entries newer than the retention window, newest first.
 * Expired entries are pruned from storage as a side effect so the list
 * stays small over time.
 */
export function getBroadcastHistory(): BroadcastHistoryEntry[] {
  const existing = getObject<BroadcastHistoryEntry[]>(StorageKeys.BROADCAST_HISTORY) ?? [];
  const cutoff = Date.now() - BROADCAST_HISTORY_RETENTION_MS;
  const live = existing.filter(e => e.createdAt >= cutoff);
  if (live.length !== existing.length) {
    setObject(StorageKeys.BROADCAST_HISTORY, live);
  }
  return live;
}

/**
 * Remove a specific broadcast from local history (e.g. because the server
 * returned 404 on /broadcast/:id/manifest — the underlying audio is gone).
 */
export function removeBroadcastFromHistory(broadcastId: string): void {
  const existing = getObject<BroadcastHistoryEntry[]>(StorageKeys.BROADCAST_HISTORY) ?? [];
  const next = existing.filter(e => e.manifest.broadcastId !== broadcastId);
  if (next.length !== existing.length) {
    setObject(StorageKeys.BROADCAST_HISTORY, next);
  }
}
