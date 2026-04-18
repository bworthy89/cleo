import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { router } from 'expo-router';
import { SettingsDrawer } from '../components/broadcast/SettingsDrawer';
import { signOut } from '../services/AuthService';
import { musicKitPlayer } from '../services/MusicKitPlayer';

interface SettingsContextValue {
  open: () => void;
  close: () => void;
  isOpen: boolean;
  /**
   * True when rendered inside a real SettingsProvider. Screens use this to
   * decide whether the cog in the StatusStrip should be shown — login and
   * onboarding sit outside the provider and shouldn't have a dead cog.
   */
  isActive: boolean;
}

const noop = () => {};

const SettingsContext = createContext<SettingsContextValue>({
  open: noop,
  close: noop,
  isOpen: false,
  isActive: false,
});

export function useSettings(): SettingsContextValue {
  return useContext(SettingsContext);
}

/**
 * Provides the global settings drawer. Any descendant can call
 * `useSettings().open()` to slide it in from the right. Sign-out is handled
 * here (drawer only emits the intent) so every tab shares the same exit flow.
 */
export function SettingsProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);

  const handleSignOut = useCallback(async () => {
    try {
      await musicKitPlayer.pause();
      await signOut();
      setIsOpen(false);
      router.replace('/(auth)/login');
    } catch {
      // sign-out failed — leave drawer open so user can retry
    }
  }, []);

  return (
    <SettingsContext.Provider value={{ open, close, isOpen, isActive: true }}>
      {children}
      <SettingsDrawer open={isOpen} onClose={close} onSignOut={handleSignOut} />
    </SettingsContext.Provider>
  );
}
