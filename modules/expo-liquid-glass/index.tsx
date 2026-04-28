import type { ReactNode } from 'react';
import { View, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import ExpoLiquidGlass, { NativeLiquidGlassView } from './src/ExpoLiquidGlassModule';

/**
 * `true` on iOS 26+, `false` on iOS 16-18. Computed once at module load via
 * `if #available(iOS 26.0, *)` on the native side. Consumers should gate
 * their solid-background fallback on this rather than sniffing the OS
 * version themselves.
 */
export const isLiquidGlassAvailable: boolean = ExpoLiquidGlass.isAvailable === true;

export type LiquidGlassIntensity = 'regular' | 'thin' | 'ultraThin';

export interface LiquidGlassViewProps {
  intensity?: LiquidGlassIntensity;
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
}

/**
 * Wraps children with iOS 26 Liquid Glass (UIGlassEffect) when available;
 * renders a transparent passthrough on iOS 16-18. Wrapped content should
 * use `backgroundColor: 'transparent'` (or gate on `isLiquidGlassAvailable`)
 * so the glass material has something to refract.
 *
 * The layout follows expo-blur's pattern: an outer RN `View` carries the
 * style and hosts the children, with the native effect view positioned as
 * an absolute-fill sibling layered BEHIND them. Putting the native effect
 * view inside a regular `<View>` keeps RN's layout, padding, and hit-testing
 * working normally — children stay direct subviews of a plain RN host.
 */
export function LiquidGlassView(props: LiquidGlassViewProps) {
  return (
    <View style={props.style}>
      <NativeLiquidGlassView
        intensity={props.intensity ?? 'regular'}
        style={StyleSheet.absoluteFill}
      />
      {props.children}
    </View>
  );
}
