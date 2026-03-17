import { useEffect, useState } from 'react';
import { FlatList, Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Colors, Typography, Spacing } from '../../src/tokens/design-tokens';
import { StationCard } from '../../src/components/StationCard';
import { musicKitPlayer } from '../../src/services/MusicKitPlayer';
import { addStation, getUser } from '../../src/services/Storage';
import type { MusicPlaylist } from '../../modules/expo-music-kit';

export default function FirstStationScreen() {
  const [playlists, setPlaylists] = useState<MusicPlaylist[]>([]);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const lists = await musicKitPlayer.fetchPlaylists();
        setPlaylists(lists);
      } catch {
        // playlists may fail — non-fatal, user sees empty grid
      }
    })();
  }, []);

  const handleSelect = (playlist: MusicPlaylist) => {
    setSelected(playlist.id);
  };

  const handleDone = () => {
    const playlist = playlists.find(p => p.id === selected);
    if (playlist) {
      addStation({
        id: `station-${Date.now()}`,
        name: playlist.name,
        playlistId: playlist.id,
        defaultVibe: getUser()?.defaultVibe ?? 'chill',
        artworkUrl: playlist.artworkUrl,
        createdAt: new Date().toISOString(),
      });
    }
    router.replace('/(main)');
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Pick Your First Station</Text>
        <Text style={styles.subtitle}>
          Choose a playlist to turn into your first radio station.
        </Text>
      </View>

      <FlatList
        data={playlists}
        keyExtractor={(item) => item.id}
        numColumns={2}
        contentContainerStyle={styles.grid}
        columnWrapperStyle={styles.row}
        renderItem={({ item }) => (
          <View style={[styles.cardWrapper, selected === item.id && styles.cardSelected]}>
            <StationCard
              name={item.name}
              artworkUrl={item.artworkUrl}
              onPress={() => handleSelect(item)}
            />
          </View>
        )}
      />

      <View style={styles.bottom}>
        <Pressable
          style={[styles.button, !selected && styles.buttonDisabled]}
          onPress={handleDone}
          disabled={!selected}
        >
          <Text style={styles.buttonText}>START LISTENING</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.vibe.morning.bg,
  },
  header: {
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.xl,
    paddingBottom: Spacing.md,
  },
  title: {
    fontFamily: Typography.display.family,
    fontSize: 28,
    color: Colors.vibe.morning.text,
    marginBottom: Spacing.sm,
  },
  subtitle: {
    fontFamily: Typography.label.family,
    fontSize: 14,
    color: Colors.vibe.morning.text,
    opacity: 0.7,
  },
  grid: {
    paddingHorizontal: Spacing.lg,
  },
  row: {
    justifyContent: 'space-between',
    marginBottom: Spacing.md,
  },
  cardWrapper: {
    borderWidth: 2,
    borderColor: 'transparent',
  },
  cardSelected: {
    borderColor: Colors.accent,
  },
  bottom: {
    paddingHorizontal: Spacing.xl,
    paddingBottom: Spacing.xxl,
  },
  button: {
    backgroundColor: Colors.base.black,
    paddingVertical: Spacing.md,
    alignItems: 'center',
  },
  buttonDisabled: {
    opacity: 0.3,
  },
  buttonText: {
    fontFamily: Typography.mono.family,
    fontSize: 14,
    color: Colors.base.white,
    letterSpacing: 3,
  },
});
