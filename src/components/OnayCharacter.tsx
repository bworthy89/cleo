import { useCallback, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import Video from 'react-native-video';

const CHARACTER_HEIGHT = 280;

export function OnayCharacter() {
  const entranceOpacity = useRef(new Animated.Value(0)).current;
  const entranceSlide = useRef(new Animated.Value(10)).current;

  // Entrance animation on tab focus
  useFocusEffect(
    useCallback(() => {
      entranceOpacity.setValue(0);
      entranceSlide.setValue(10);
      Animated.parallel([
        Animated.timing(entranceOpacity, {
          toValue: 1,
          duration: 400,
          useNativeDriver: true,
        }),
        Animated.timing(entranceSlide, {
          toValue: 0,
          duration: 400,
          useNativeDriver: true,
        }),
      ]).start();
    }, []),
  );

  return (
    <Animated.View
      style={[
        styles.container,
        {
          opacity: entranceOpacity,
          transform: [{ translateY: entranceSlide }],
        },
      ]}
    >
      <Video
        source={require('../../assets/cleo/onay-animation.mp4')}
        style={styles.video}
        resizeMode="contain"
        repeat
        muted
        disableFocus
        playWhenInactive={false}
        playInBackground={false}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    height: CHARACTER_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  video: {
    height: CHARACTER_HEIGHT,
    width: CHARACTER_HEIGHT * (720 / 1280), // match video aspect ratio
  },
});
