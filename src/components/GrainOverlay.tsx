import { Image, StyleSheet, View } from 'react-native';

export function GrainOverlay() {
  return (
    <View style={styles.container} pointerEvents="none">
      <Image
        source={require('../../assets/textures/grain.png')}
        style={styles.grain}
        resizeMode="repeat"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1,
  },
  grain: {
    width: '100%',
    height: '100%',
    opacity: 0.05,
  },
});
