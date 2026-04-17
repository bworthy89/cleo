import { useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import {
  Colors, Surface, TextColors, Spacing, Typography, Radius, Gradient, Glow,
} from '../../tokens/design-tokens';
import type { MusicPlaylist } from '../../../modules/expo-music-kit';
import { SetupSheet, type SetupResult } from './SetupSheet';

interface Props {
  playlists: MusicPlaylist[];
  playlistsLoading?: boolean;
  playlistsError?: string | null;
  onRetryPlaylists?: () => void;
  onOpenAskOnay?: () => void;
  onSubmit: (result: SetupResult) => void;
}

export function YourBroadcastSetup({
  playlists, playlistsLoading, playlistsError, onRetryPlaylists, onOpenAskOnay, onSubmit,
}: Props) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Pressable
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
          setOpen(true);
        }}
        accessibilityRole="button"
        accessibilityLabel="Start your broadcast"
        style={({ pressed }) => ({
          borderRadius: Radius.md,
          overflow: 'hidden',
          shadowColor: Glow.ctaShadow.shadowColor,
          shadowOffset: Glow.ctaShadow.shadowOffset,
          shadowOpacity: pressed ? 0.18 : Glow.ctaShadow.shadowOpacity,
          shadowRadius: Glow.ctaShadow.shadowRadius,
          elevation: pressed ? 8 : 12,
          transform: [{ scale: pressed ? 0.98 : 1 }],
        })}
      >
        <LinearGradient
          colors={Gradient.cta.colors as unknown as readonly [string, string]}
          start={Gradient.cta.start}
          end={Gradient.cta.end}
          style={{
            padding: Spacing.lg,
            flexDirection: 'row',
            alignItems: 'center',
            gap: Spacing.md,
            minHeight: 100,
          }}
        >
          <View style={{
            width: 52, height: 52, borderRadius: 26,
            backgroundColor: 'rgba(13, 13, 13, 0.22)',
            alignItems: 'center', justifyContent: 'center',
          }}>
            <Ionicons name="play" size={24} color={Colors.base.black} style={{ marginLeft: 3 }} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{
              color: 'rgba(13, 13, 13, 0.62)',
              fontFamily: Typography.mono.family,
              fontSize: 10,
              letterSpacing: 2,
              marginBottom: 2,
            }}>
              START
            </Text>
            <Text style={{
              color: Colors.base.black,
              fontFamily: Typography.display.family,
              fontSize: 22,
              lineHeight: 26,
            }} numberOfLines={2}>
              Build your broadcast
            </Text>
            <Text style={{
              color: 'rgba(13, 13, 13, 0.72)',
              fontSize: 13,
              marginTop: 2,
            }}>
              Pick a playlist, vibe, length.
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={22} color={Colors.base.black} />
        </LinearGradient>
      </Pressable>

      <SetupSheet
        visible={open}
        playlists={playlists}
        playlistsLoading={playlistsLoading}
        playlistsError={playlistsError}
        onRetryPlaylists={onRetryPlaylists}
        onAskOnay={onOpenAskOnay ? () => { setOpen(false); onOpenAskOnay(); } : undefined}
        onClose={() => setOpen(false)}
        onSubmit={(r) => { setOpen(false); onSubmit(r); }}
      />
    </>
  );
}

/**
 * Ghost-button alternative entry — routes to Ask ONAY curation.
 * Intentionally visually subordinate to the primary CTA.
 */
interface AskOnayButtonProps { onPress: () => void }
export function AskOnayButton({ onPress }: AskOnayButtonProps) {
  const handlePress = () => {
    Haptics.selectionAsync().catch(() => {});
    onPress();
  };
  return (
    <Pressable
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel="Ask ONAY to curate a playlist"
      style={({ pressed }) => ({
        marginTop: Spacing.sm,
        paddingVertical: Spacing.md,
        paddingHorizontal: Spacing.md,
        backgroundColor: Surface.base,
        borderRadius: Radius.sm,
        borderWidth: 1,
        borderColor: TextColors.outlineVariant,
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.sm,
        opacity: pressed ? 0.75 : 1,
      })}
    >
      <Ionicons name="sparkles-outline" size={16} color={Colors.accent} />
      <Text style={{
        color: Colors.accent,
        fontFamily: Typography.mono.family,
        fontSize: 11,
        letterSpacing: 2,
        flex: 1,
      }}>
        OR ASK ONAY TO CURATE
      </Text>
      <Ionicons name="chevron-forward" size={16} color={TextColors.outline} />
    </Pressable>
  );
}
