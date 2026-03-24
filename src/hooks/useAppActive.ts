import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

/**
 * Returns true when the app is in the foreground, false when backgrounded.
 * Use this to pause animations and other visual-only work that wastes CPU
 * when the screen is off.
 */
export function useAppActive(): boolean {
  const [active, setActive] = useState(AppState.currentState === 'active');
  const ref = useRef(active);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      const isActive = state === 'active';
      if (ref.current !== isActive) {
        ref.current = isActive;
        setActive(isActive);
      }
    });
    return () => sub.remove();
  }, []);

  return active;
}
