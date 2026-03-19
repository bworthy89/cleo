import { storage } from './Storage';

export interface SessionMemoryData {
  lastStationId: string;
  lastVibe: string;
  lastArtists: string[];
  lastTrackTitle: string;
  lastArtistName: string;
  lastTimestamp: number;
  sessionCount: number;
}

const KEY = 'session.memory';

export function saveSessionMemory(data: Partial<SessionMemoryData>): void {
  const existing = loadSessionMemory();
  const merged = { ...existing, ...data };
  storage.set(KEY, JSON.stringify(merged));
}

export function loadSessionMemory(): SessionMemoryData | null {
  const raw = storage.getString(KEY);
  if (!raw) return null;
  return JSON.parse(raw) as SessionMemoryData;
}

export function getTimeSinceLastSession(): { hours: number; sameDay: boolean; label: string } | null {
  const mem = loadSessionMemory();
  if (!mem?.lastTimestamp) return null;

  const ms = Date.now() - mem.lastTimestamp;
  const hours = Math.floor(ms / 3600000);
  const today = new Date();
  const last = new Date(mem.lastTimestamp);
  const sameDay = today.toDateString() === last.toDateString();

  let label: string;
  if (hours < 1) label = 'just now';
  else if (hours < 4) label = `${hours} hour${hours === 1 ? '' : 's'} ago`;
  else if (sameDay) label = 'earlier today';
  else if (hours < 48) label = 'yesterday';
  else {
    const days = Math.floor(hours / 24);
    label = `${days} day${days === 1 ? '' : 's'} ago`;
  }

  return { hours, sameDay, label };
}

export function incrementSessionCount(): number {
  const mem = loadSessionMemory();
  const count = (mem?.sessionCount ?? 0) + 1;
  saveSessionMemory({ sessionCount: count });
  return count;
}

export function clearSessionMemory(): void {
  storage.remove(KEY);
}
