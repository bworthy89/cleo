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

/**
 * Polls /health/public while the app is active. Returns null until the
 * first successful response (so consumers can render nothing during the
 * cold-start window). On error, retains the last known status — does NOT
 * surface as a banner just because the network blipped.
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
        const data: HealthStatus = await res.json();
        if (!cancelled) setStatus(data);
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
