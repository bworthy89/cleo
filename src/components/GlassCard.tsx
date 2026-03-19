import { StyleSheet, View, type ViewProps } from 'react-native';
import { BlurView } from 'expo-blur';
import { Glass, Radius } from '../tokens/design-tokens';

interface GlassCardProps extends ViewProps {
  variant?: 'default' | 'dark';
  blur?: boolean;
  radius?: number;
}

export function GlassCard({ variant = 'default', blur = false, radius = Radius.lg, style, children, ...props }: GlassCardProps) {
  const glass = variant === 'dark' ? Glass.panelDark : Glass.panel;

  if (blur) {
    return (
      <View style={[{ borderRadius: radius, overflow: 'hidden', borderWidth: 1, borderColor: Glass.border }, style]} {...props}>
        <BlurView intensity={glass.blur} tint={glass.tint} style={StyleSheet.absoluteFill} />
        <View style={{ backgroundColor: glass.bg }}>{children}</View>
      </View>
    );
  }

  return (
    <View style={[{
      backgroundColor: glass.bg,
      borderRadius: radius,
      borderWidth: 1,
      borderColor: Glass.border,
    }, style]} {...props}>
      {children}
    </View>
  );
}
