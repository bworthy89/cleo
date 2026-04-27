import { authenticatedFetch } from './api';
import type { ScrobblePayload, ScrobbleEventPayload } from '../engines/Scrobbler.types';

async function postJson(path: string, body?: unknown): Promise<Response> {
  const init: RequestInit = { method: 'POST' };
  if (body !== undefined) init.body = JSON.stringify(body);
  const res = await authenticatedFetch(path, init);
  if (!res.ok && res.status !== 204) {
    throw new Error(`${path} → ${res.status}`);
  }
  return res;
}

export async function fetchAuthUrl(): Promise<string> {
  const res = await postJson('/lastfm/auth-url');
  const data = await res.json() as { url: string };
  return data.url;
}

export async function connect(token: string): Promise<void> {
  await postJson('/lastfm/connect', { token });
}

export async function disconnect(): Promise<void> {
  await postJson('/lastfm/disconnect');
}

export async function nowPlaying(p: ScrobblePayload): Promise<void> {
  await postJson('/lastfm/now-playing', p);
}

export async function scrobble(p: ScrobbleEventPayload): Promise<void> {
  await postJson('/lastfm/scrobble', p);
}
