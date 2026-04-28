import * as React from 'react';
import { View } from 'react-native';

export const isLiquidGlassAvailable = false;

export type LiquidGlassIntensity = 'regular' | 'thin' | 'ultraThin';

export interface LiquidGlassViewProps {
  intensity?: LiquidGlassIntensity;
  style?: any;
  children?: React.ReactNode;
}

export function LiquidGlassView(props: LiquidGlassViewProps) {
  // Render a plain View so children appear in the test tree. Tests against
  // chrome surfaces don't need to know about the native effect — they just
  // need the wrapper to be transparent in the test runtime.
  return React.createElement(View, { style: props.style, testID: 'mock-liquid-glass' }, props.children);
}
