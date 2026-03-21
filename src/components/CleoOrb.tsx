import React from 'react';
import { View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Colors, Surface, withAlpha } from '../tokens/design-tokens';

interface CleoOrbProps {
  size?: number;
  showGlow?: boolean;
}

export function CleoOrb({ size = 28, showGlow = false }: CleoOrbProps) {
  const innerSize = size - 6;

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }} accessible accessibilityLabel="ONAY" accessibilityRole="image">
      {showGlow && (
        <View
          style={{
            position: 'absolute',
            width: size + 80,
            height: size + 80,
            borderRadius: 9999,
            backgroundColor: Colors.accent,
            opacity: 0.15,
          }}
        />
      )}
      <LinearGradient
        colors={[Colors.accent, withAlpha(Colors.accent, 0.4)]}
        style={{
          width: size,
          height: size,
          borderRadius: 9999,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <View
          style={{
            width: innerSize,
            height: innerSize,
            borderRadius: 9999,
            backgroundColor: Surface.base,
          }}
        />
      </LinearGradient>
    </View>
  );
}
