import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Image, StyleSheet, View } from 'react-native';
import { useFocusEffect } from 'expo-router';

const FRAMES = [
  require('../../assets/cleo/onay-frame-1.png'),
  require('../../assets/cleo/onay-frame-2.png'),
  require('../../assets/cleo/onay-frame-3.png'),
];

const FRAME_INTERVAL = 3000;
const CROSSFADE_DURATION = 800;
const CHARACTER_HEIGHT = 200;

export function OnayCharacter() {
  const [currentFrame, setCurrentFrame] = useState(0);
  const fadeIn = useRef(new Animated.Value(1)).current;
  const fadeOut = useRef(new Animated.Value(0)).current;
  const entranceOpacity = useRef(new Animated.Value(0)).current;
  const entranceSlide = useRef(new Animated.Value(10)).current;
  const prevFrameRef = useRef(0);

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

  // Idle crossfade loop
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentFrame((prev) => {
        const next = (prev + 1) % FRAMES.length;
        prevFrameRef.current = prev;

        // Reset fade values for crossfade
        fadeIn.setValue(0);
        fadeOut.setValue(1);

        Animated.parallel([
          Animated.timing(fadeIn, {
            toValue: 1,
            duration: CROSSFADE_DURATION,
            useNativeDriver: true,
          }),
          Animated.timing(fadeOut, {
            toValue: 0,
            duration: CROSSFADE_DURATION,
            useNativeDriver: true,
          }),
        ]).start();

        return next;
      });
    }, FRAME_INTERVAL);

    return () => clearInterval(interval);
  }, []);

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
      {/* Outgoing frame */}
      <Animated.Image
        source={FRAMES[prevFrameRef.current]}
        style={[styles.frame, { opacity: fadeOut }]}
        resizeMode="contain"
      />
      {/* Incoming frame */}
      <Animated.Image
        source={FRAMES[currentFrame]}
        style={[styles.frame, { opacity: fadeIn }]}
        resizeMode="contain"
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
  frame: {
    position: 'absolute',
    height: CHARACTER_HEIGHT,
    width: CHARACTER_HEIGHT * 0.8, // 4:5 aspect ratio
  },
});
