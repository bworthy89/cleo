import { Image, StyleSheet, View } from 'react-native';
import { GrainOpacity } from '../tokens/design-tokens';

/**
 * Full-bleed tiled grain overlay. Renders as an absolute layer on top of its
 * parent's background; pass-through for touches. Uses the static PNG at
 * `assets/textures/grain.png` tiled via `resizeMode="repeat"`.
 */
export function Grain() {
  return (
    <View
      pointerEvents="none"
      style={StyleSheet.absoluteFill}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Image
        source={require('../../assets/textures/grain.png')}
        resizeMode="repeat"
        style={[StyleSheet.absoluteFill, { opacity: GrainOpacity }]}
      />
    </View>
  );
}
