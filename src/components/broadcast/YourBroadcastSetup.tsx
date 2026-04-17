import { useState } from 'react';
import { Text, Pressable } from 'react-native';
import { Colors, Surface, TextColors, Spacing, Typography, Radius } from '../../tokens/design-tokens';
import type { MusicPlaylist } from '../../../modules/expo-music-kit';
import { SetupSheet, type SetupResult } from './SetupSheet';

interface Props {
  playlists: MusicPlaylist[];
  onSubmit: (result: SetupResult) => void;
}

export function YourBroadcastSetup({ playlists, onSubmit }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel="Start your own broadcast"
        style={{
          backgroundColor: Surface.container,
          borderLeftWidth: 2,
          borderLeftColor: Colors.accent,
          padding: Spacing.lg,
          borderRadius: Radius.sm,
        }}
      >
        <Text style={{
          color: Colors.accent,
          fontFamily: Typography.mono.family,
          fontSize: 10,
          letterSpacing: 2,
          marginBottom: Spacing.xs,
        }}>
          START YOUR BROADCAST
        </Text>
        <Text style={{ color: TextColors.primary, fontFamily: Typography.display.family, fontSize: 22 }}>
          Pick a playlist. Pick a vibe. Hit play.
        </Text>
        <Text style={{ color: TextColors.secondary, marginTop: Spacing.xs }}>
          ONAY builds the set and takes you through.
        </Text>
      </Pressable>

      <SetupSheet
        visible={open}
        playlists={playlists}
        onClose={() => setOpen(false)}
        onSubmit={(r) => { setOpen(false); onSubmit(r); }}
      />
    </>
  );
}
