import { useEffect, useState, useRef } from 'react';
import { API_BASE_URL } from '../services/api';
import { useAppActive } from './useAppActive';

export type ComponentStatus = 'operational' | 'degraded' | 'major';

export interface HealthStatus {
  status: ComponentStatus;
  checkedAt: string;
  components: {
    tts: {
      status: ComponentStatus;
      active: string;
      primary: { name: string; healthy: boolean };
      fallback: { name: string; healthy: boolean };
    };
    bake: { status: ComponentStatus; queueDepth: number };
  };
}

const POLL_INTERVAL_MS = 60_000;

function isComponentStatus(v: unknown): v is ComponentStatus {
  return v === 'operational' || v === 'degraded' || v === 'major';
}

function isProviderInfo(v: unknown): v is { name: string; healthy: boolean } {
  if (!v || typeof v !== 'object') return false;
  const p = v as Partial<{ name: string; healthy: boolean }>;
  return typeof p.name === 'string' && typeof p.healthy === 'boolean';
}

/**
 * Runtime guard against server-side schema drift or unexpected error
 * payloads. The TS interface alone is just a compile-time assertion;
 * without this guard, a shape mismatch crashes the banner at render.
 */
function isHealthStatus(data: unknown): data is HealthStatus {
  if (!data || typeof data !== 'object') return false;
  const d = data as Partial<HealthStatus>;
  if (!isComponentStatus(d.status)) return false;
  if (typeof d.checkedAt !== 'string') return false;
  if (!d.components || typeof d.components !== 'object') return false;
  const c = d.components;
  if (!c.tts || typeof c.tts !== 'object') return false;
  if (!isComponentStatus(c.tts.status)) return false;
  if (typeof c.tts.active !== 'string') return false;
  if (!isProviderInfo(c.tts.primary)) return false;
  if (!isProviderInfo(c.tts.fallback)) return false;
  if (!c.bake || typeof c.bake !== 'object') return false;
  if (!isComponentStatus(c.bake.status)) return false;
  if (typeof c.bake.queueDepth !== 'number') return false;
  return true;
}

/**
 * Polls /health/public while the app is active. Returns null until the
 * first successful response (so consumers can render nothing during the
 * cold-start window). On error or malformed payload, retains the last
 * known status — does NOT surface as a banner just because the network
 * blipped or the server schema drifted.
 */
export function useHealthStatus(): HealthStatus | null {
  const [status, setStatus] = useState<HealthStatus | null>(null);
  const appActive = useAppActive();
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!appActive) {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      return;
    }

    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/health/public`);
        if (!res.ok) return;
        const raw: unknown = await res.json();
        if (!isHealthStatus(raw)) {
          // Server returned an unexpected shape — schema drift, an error
          // body, or a non-JSON payload that happened to parse. Skip
          // setState; banner stays on last-known good value.
          return;
        }
        if (!cancelled) setStatus(raw);
      } catch {
        // Network blip — keep last known status; banner doesn't flicker.
      }
    };

    void poll();
    timerRef.current = setInterval(poll, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [appActive]);

  return status;
}
