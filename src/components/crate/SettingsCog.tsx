import { Pressable, StyleSheet, View } from 'react-native';
import { AM } from '../../tokens/design-tokens';
import { useSettings } from '../../contexts/SettingsContext';

interface Props {
  /** Override bar color — e.g. cream for oxblood panels. Default inkDim. */
  color?: string;
  /** Override size. Default 14 (matches StatusStrip cog). */
  size?: number;
}

/**
 * Three-bar "cog" button that opens the settings drawer. Matches the icon
 * baked into `StatusStrip`, exported so screens that replace the strip
 * with their own masthead (Tonight, Crates) still expose a settings entry.
 *
 * Visual icon stays small (14×~7pt) so it reads as restrained editorial
 * chrome. The Pressable's `hitSlop` expands the effective tap target to
 * roughly 46×43pt, satisfying iOS HIG 44×44 without inflating the cog's
 * layout footprint inside StatusStrip's flex row.
 *
 * Renders nothing if no SettingsProvider is in scope (login/onboarding).
 */
export function SettingsCog({ color, size = 14 }: Props) {
  const settings = useSettings();
  if (!settings.isActive) return null;

  const fill = color ?? AM.inkDim;

  return (
    <Pressable
      onPress={settings.open}
      accessibilityRole="button"
      accessibilityLabel="Open settings"
      hitSlop={{ top: 18, bottom: 18, left: 16, right: 16 }}
      style={({ pressed }) => [styles.btn, pressed && { opacity: 0.5 }]}
    >
      <View style={{ width: size, height: 1, backgroundColor: fill }} />
      <View style={{ width: size, height: 1, marginTop: 3, backgroundColor: fill }} />
      <View style={{ width: size, height: 1, marginTop: 3, backgroundColor: fill }} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    padding: 4,
  },
});
