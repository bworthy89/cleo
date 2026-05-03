import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/**
 * Returns true when the user has enabled "Reduce Motion" in iOS Settings.
 * Animation loops should still themselves on this so vestibular-sensitive
 * users get a still frame instead of continuous rotation, pulsing dots, or
 * dancing VU bars.
 *
 * Mirrors `useAppActive`'s shape: subscribed event listener, ref-guarded
 * setState to avoid extra renders when the value hasn't actually changed.
 */
export function useReduceMotion(): boolean {
  const [enabled, setEnabled] = useState(false);
  const ref = useRef(enabled);

  useEffect(() => {
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (cancelled) return;
      if (ref.current !== value) {
        ref.current = value;
        setEnabled(value);
      }
    });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', (value) => {
      if (ref.current !== value) {
        ref.current = value;
        setEnabled(value);
      }
    });
    return () => {
      cancelled = true;
      sub.remove();
    };
  }, []);

  return enabled;
}
