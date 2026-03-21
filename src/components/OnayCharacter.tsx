import { useCallback, useRef, useState } from 'react';
import { Animated, Image, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect } from 'expo-router';
import Video from 'react-native-video';
import { Colors, Surface, withAlpha } from '../tokens/design-tokens';

const FRAME_SIZE = 220;
const VIDEO_SCALE = 1.25;

export function OnayCharacter() {
  const [videoFailed, setVideoFailed] = useState(false);
  const entranceOpacity = useRef(new Animated.Value(0)).current;
  const entranceSlide = useRef(new Animated.Value(10)).current;

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
        styles.outerContainer,
        {
          opacity: entranceOpacity,
          transform: [{ translateY: entranceSlide }],
        },
      ]}
    >
      <View style={styles.glow} />

      <LinearGradient
        colors={[Colors.accent, withAlpha(Colors.accent, 0.3)]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.frameBorder}
      >
        <View style={styles.frameInner}>
          <View style={styles.videoClip}>
            {videoFailed ? (
              <Image
                source={require('../../assets/cleo/onay-frame-1.png')}
                style={styles.fallbackImage}
                resizeMode="cover"
              />
            ) : (
              <Video
                source={require('../../assets/cleo/onay-animation.mp4')}
                style={styles.video}
                resizeMode="cover"
                repeat
                muted
                disableFocus
                disableAudioSessionManagement
                playWhenInactive={false}
                playInBackground={false}
                onError={() => setVideoFailed(true)}
              />
            )}
          </View>
        </View>
      </LinearGradient>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  outerContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
  },
  glow: {
    position: 'absolute',
    width: FRAME_SIZE + 40,
    height: FRAME_SIZE + 40,
    borderRadius: FRAME_SIZE,
    backgroundColor: Colors.accent,
    opacity: 0.08,
  },
  frameBorder: {
    width: FRAME_SIZE + 4,
    height: FRAME_SIZE + 4,
    borderRadius: FRAME_SIZE / 2 + 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  frameInner: {
    width: FRAME_SIZE,
    height: FRAME_SIZE,
    borderRadius: FRAME_SIZE / 2,
    backgroundColor: Surface.base,
    overflow: 'hidden',
  },
  videoClip: {
    width: FRAME_SIZE,
    height: FRAME_SIZE,
    overflow: 'hidden',
    alignItems: 'center',
  },
  video: {
    width: FRAME_SIZE,
    height: FRAME_SIZE * VIDEO_SCALE,
    marginTop: -(FRAME_SIZE * (VIDEO_SCALE - 1)) * 0.3,
  },
  fallbackImage: {
    width: FRAME_SIZE,
    height: FRAME_SIZE,
  },
});
