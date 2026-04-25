import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { AM, Fonts, Space, TypeScale } from '../tokens/design-tokens';
import { useHealthStatus, type ComponentStatus } from '../hooks/useHealthStatus';

interface BannerCopy {
  title: string;
  subtitle: string;
}

function copyFor(status: ComponentStatus, ttsActive: string): BannerCopy | null {
  if (status === 'operational') return null;
  if (status === 'degraded') {
    return {
      title: 'ONAY IS RUNNING IN BACKUP MODE',
      subtitle: `Voice via ${ttsActive}. Bakes may take a moment longer than usual.`,
    };
  }
  return {
    title: 'ONAY IS DEGRADED',
    subtitle: 'Voice services are running on emergency fallback. Some bakes may fail.',
  };
}

export function HealthStatusBanner(): React.ReactElement | null {
  const status = useHealthStatus();
  const [dismissedFor, setDismissedFor] = useState<string | null>(null);

  if (!status) return null;
  if (dismissedFor && dismissedFor === status.checkedAt) return null;

  const copy = copyFor(status.status, status.components.tts.active);
  if (!copy) return null;

  return (
    <Pressable
      onPress={() => {
        void Haptics.selectionAsync();
        setDismissedFor(status.checkedAt);
      }}
      accessibilityRole="button"
      accessibilityLabel={`${copy.title}. Tap to dismiss.`}
      style={({ pressed }) => [styles.container, pressed && { opacity: 0.8 }]}
    >
      <View style={styles.bar} />
      <View style={styles.body}>
        <Text style={styles.title}>{copy.title}</Text>
        <Text style={styles.subtitle}>{copy.subtitle}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    backgroundColor: AM.bgDeep,
    borderTopColor: AM.amberDim,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomColor: AM.amberDim,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  bar: {
    width: Space.s2,
    backgroundColor: AM.amber,
  },
  body: {
    flex: 1,
    paddingHorizontal: Space.s16,
    paddingVertical: Space.s12,
  },
  title: {
    fontFamily: Fonts.mono,
    fontSize: TypeScale.s10,
    color: AM.amber,
    letterSpacing: 1.5,
  },
  subtitle: {
    fontFamily: Fonts.mono,
    fontSize: TypeScale.s11,
    color: AM.inkMid,
    marginTop: Space.s4,
  },
});
