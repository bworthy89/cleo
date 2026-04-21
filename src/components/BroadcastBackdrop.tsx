import type { ReactNode } from 'react';
import { StyleSheet, View, type ViewStyle, type StyleProp } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { AM, AMBloom } from '../tokens/design-tokens';
import { Grain } from './Grain';

/**
 * Analog Midnight app backdrop: warm near-black fill, amber radial bloom at
 * the top, and a tiled grain overlay. Every screen root that wants the new
 * design language should wrap its content with this.
 *
 * React Native has no true radial gradient, so the bloom is approximated with
 * a vertical `LinearGradient` — close enough at phone scale; the visual
 * anchor is the warm top band, not a perfect ellipse.
 */
export function BroadcastBackdrop({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.root, style]}>
      <LinearGradient
        pointerEvents="none"
        colors={AMBloom.colors}
        locations={[AMBloom.locations[0], AMBloom.locations[1], AMBloom.locations[2]]}
        start={AMBloom.start}
        end={AMBloom.end}
        style={StyleSheet.absoluteFill}
      />
      <Grain />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: AM.bg,
  },
});
