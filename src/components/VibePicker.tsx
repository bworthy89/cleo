import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Colors,
  Surface,
  TextColors,
  Typography,
  Spacing,
  Radius,
  withAlpha,
} from '../tokens/design-tokens';
import type { Vibe } from '../cleo/fallbacks';

const VIBES: { key: Vibe; label: string }[] = [
  { key: 'morning', label: 'Morning' },
  { key: 'chill', label: 'Chill' },
  { key: 'focus', label: 'Focus' },
  { key: 'feelGood', label: 'Feel Good' },
  { key: 'workout', label: 'Workout' },
  { key: 'party', label: 'Party' },
  { key: 'lateNight', label: 'Late Night' },
  { key: 'elevated', label: 'Elevated' },
  { key: 'throwback', label: 'Throwback' },
  { key: 'melancholy', label: 'Melancholy' },
  { key: 'sunday', label: 'Sunday' },
  { key: 'general', label: 'General' },
];

interface VibePickerProps {
  visible: boolean;
  stationName: string;
  artworkUrl?: string;
  currentVibe: Vibe;
  onSelect: (vibe: Vibe) => void;
  onDismiss: () => void;
}

export function VibePicker({
  visible,
  stationName,
  artworkUrl,
  currentVibe,
  onSelect,
  onDismiss,
}: VibePickerProps) {
  const { height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const sheetHeight = windowHeight * 0.52;
  const [selectedVibe, setSelectedVibe] = useState<Vibe>(currentVibe);
  const slideAnim = useRef(new Animated.Value(sheetHeight)).current;

  useEffect(() => {
    if (visible) {
      setSelectedVibe(currentVibe);
      Animated.spring(slideAnim, {
        toValue: 0,
        damping: 20,
        stiffness: 200,
        useNativeDriver: true,
      }).start();
    } else {
      Animated.timing(slideAnim, {
        toValue: sheetHeight,
        duration: 250,
        useNativeDriver: true,
      }).start();
    }
  }, [visible]);

  const handleConfirm = () => {
    onSelect(selectedVibe);
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={onDismiss}
    >
      <Pressable style={styles.backdrop} onPress={onDismiss}>
        <View />
      </Pressable>

      <Animated.View
        style={[
          styles.sheet,
          {
            height: sheetHeight,
            paddingBottom: Math.max(Spacing.xl, insets.bottom + Spacing.md),
            transform: [{ translateY: slideAnim }],
          },
        ]}
      >
        {/* Drag handle */}
        <View style={styles.handleContainer}>
          <View style={styles.handle} />
        </View>

        {/* Station info */}
        <View style={styles.stationRow}>
          {artworkUrl ? (
            <Image source={{ uri: artworkUrl }} style={styles.stationArt} />
          ) : (
            <View style={[styles.stationArt, styles.stationArtPlaceholder]} />
          )}
          <Text style={styles.stationName} numberOfLines={1}>{stationName}</Text>
        </View>

        {/* Section label */}
        <Text style={styles.sectionLabel}>SET YOUR VIBE</Text>

        {/* Vibe grid */}
        <View style={styles.vibeGrid}>
          {VIBES.map((v) => {
            const isSelected = selectedVibe === v.key;
            return (
              <Pressable
                key={v.key}
                onPress={() => setSelectedVibe(v.key)}
                accessibilityLabel={`${v.label} vibe${isSelected ? ', selected' : ''}`}
                accessibilityRole="button"
              >
                <View style={[styles.vibePill, isSelected && styles.vibePillSelected]}>
                  <Text style={[styles.vibeText, isSelected && styles.vibeTextSelected]}>
                    {v.label}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>

        {/* CTA */}
        <Pressable
          onPress={handleConfirm}
          style={({ pressed }) => [styles.ctaButton, pressed && styles.ctaPressed]}
          accessibilityLabel="Start broadcast"
          accessibilityRole="button"
        >
          <Text style={styles.ctaText}>START BROADCAST</Text>
        </Pressable>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  sheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: Surface.container,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    paddingHorizontal: Spacing.lg,
  },
  handleContainer: {
    alignItems: 'center',
    paddingVertical: Spacing.md,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: TextColors.outlineVariant,
  },

  // Station info
  stationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    marginBottom: Spacing.lg,
  },
  stationArt: {
    width: 40,
    height: 40,
    borderRadius: Radius.sm,
  },
  stationArtPlaceholder: {
    backgroundColor: Surface.high,
  },
  stationName: {
    fontFamily: Typography.display.family,
    fontSize: 18,
    color: TextColors.primary,
    flex: 1,
  },

  // Section label
  sectionLabel: {
    fontFamily: Typography.mono.family,
    fontSize: 10,
    letterSpacing: 2.5,
    color: Colors.accent,
    marginBottom: Spacing.md,
  },

  // Vibe grid
  vibeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    marginBottom: Spacing.lg,
  },
  vibePill: {
    backgroundColor: Surface.high,
    borderWidth: 1,
    borderColor: TextColors.outlineVariant,
    borderRadius: Radius.full,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
  },
  vibePillSelected: {
    backgroundColor: withAlpha(Colors.accent, 0.15),
    borderColor: Colors.accent,
  },
  vibeText: {
    fontFamily: Typography.body.familyMedium,
    fontSize: 13,
    color: TextColors.secondary,
  },
  vibeTextSelected: {
    color: Colors.accent,
  },

  // CTA
  ctaButton: {
    borderWidth: 1,
    borderColor: Colors.accent,
    paddingVertical: Spacing.md,
    alignItems: 'center',
  },
  ctaPressed: {
    opacity: 0.7,
  },
  ctaText: {
    fontFamily: Typography.mono.family,
    fontSize: 12,
    color: Colors.accent,
    letterSpacing: 3,
  },
});
