import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  Pressable,
  Image,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Colors, Typography, Spacing, Radius, Surface, TextColors } from '../../tokens/design-tokens';
import { curatePlaylist, refinePlaylist, CuratedPlaylist } from '../../engines/PlaylistCurator';
import { createPlaylist, authorize } from '../../../modules/expo-music-kit';
import { queueManager } from '../../engines/QueueManager';
import { addStation } from '../../services/Storage';
import { sessionEngine } from '../../engines/SessionEngine';

type MessageRole = 'user' | 'onay' | 'playlist' | 'loading' | 'error';

interface ChatMessage {
  id: string;
  role: MessageRole;
  text?: string;
  playlist?: CuratedPlaylist;
}

export function AskOnayScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ suggestion?: string }>();
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      role: 'onay',
      text: '\u201CWhat kind of playlist are you in the mood for?\u201D',
    },
  ]);
  const [inputText, setInputText] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [currentPlaylist, setCurrentPlaylist] = useState<CuratedPlaylist | null>(null);
  const [originalPrompt, setOriginalPrompt] = useState('');
  const flatListRef = useRef<FlatList>(null);
  const messageIdCounter = useRef(1);

  // Handle pre-filled suggestion from home screen "ONAY SUGGESTS" card
  const pendingSuggestionRef = useRef<string | null>(null);

  useEffect(() => {
    if (params.suggestion) {
      try {
        const suggestion = JSON.parse(params.suggestion);
        // Store the prompt in a ref and trigger send directly
        pendingSuggestionRef.current = suggestion.playlistTitle;
      } catch {}
    }
  }, []);

  // Auto-send when pending suggestion is set (runs after mount)
  useEffect(() => {
    if (pendingSuggestionRef.current && !isGenerating) {
      const prompt = pendingSuggestionRef.current;
      pendingSuggestionRef.current = null;
      setInputText(prompt);
      // Directly invoke curation with the prompt text, bypassing inputText state
      (async () => {
        addMessage({ role: 'user', text: prompt });
        setIsGenerating(true);
        const loadingId = addMessage({ role: 'loading' });
        try {
          setOriginalPrompt(prompt);
          const result = await curatePlaylist({ prompt });
          removeMessage(loadingId);
          setCurrentPlaylist(result);
          addMessage({ role: 'onay', text: `\u201C${result.conversationalResponse}\u201D` });
          addMessage({ role: 'playlist', playlist: result });
        } catch (error: any) {
          removeMessage(loadingId);
          addMessage({ role: 'error', text: error.message || 'Something went wrong.' });
        } finally {
          setIsGenerating(false);
        }
      })();
    }
  }, []);

  const nextId = () => String(messageIdCounter.current++);

  const addMessage = useCallback((msg: Omit<ChatMessage, 'id'>) => {
    const newMsg = { ...msg, id: nextId() };
    setMessages(prev => [...prev, newMsg]);
    return newMsg.id;
  }, []);

  const removeMessage = useCallback((id: string) => {
    setMessages(prev => prev.filter(m => m.id !== id));
  }, []);

  const handleSend = useCallback(async () => {
    const text = inputText.trim();
    if (!text || isGenerating) return;

    // Block during active broadcast
    const activeSession = sessionEngine.getSession();
    if (activeSession) {
      addMessage({
        role: 'error',
        text: 'Playlist curation is unavailable during an active broadcast. End your session first.',
      });
      return;
    }

    // Check Apple Music subscription
    const authResult = await authorize();
    if (!authResult.canPlayCatalog) {
      addMessage({
        role: 'error',
        text: 'An Apple Music subscription is required to create playlists. Please subscribe in the Music app.',
      });
      return;
    }

    setInputText('');
    addMessage({ role: 'user', text });

    setIsGenerating(true);
    const loadingId = addMessage({ role: 'loading' });

    try {
      let result: CuratedPlaylist;

      if (currentPlaylist) {
        // Refinement round
        result = await refinePlaylist(
          {
            userFeedback: text,
            existingTracks: currentPlaylist.tracks.map(t => ({
              title: t.title,
              artist: t.artistName,
            })),
          },
          originalPrompt,
          currentPlaylist.suggestedVibe
        );
      } else {
        // Initial round
        setOriginalPrompt(text);
        result = await curatePlaylist({ prompt: text });
      }

      removeMessage(loadingId);
      setCurrentPlaylist(result);

      addMessage({ role: 'onay', text: `\u201C${result.conversationalResponse}\u201D` });
      addMessage({ role: 'playlist', playlist: result });
    } catch (error: any) {
      removeMessage(loadingId);
      addMessage({
        role: 'error',
        text: error.message || 'Something went wrong. Try again.',
      });
    } finally {
      setIsGenerating(false);
    }
  }, [inputText, isGenerating, currentPlaylist, originalPrompt, addMessage, removeMessage]);

  const handleSave = useCallback(async (playlist: CuratedPlaylist) => {
    try {
      const description = `${playlist.playlistDescription} \u2014 Curated by ONAY`;
      await createPlaylist(playlist.playlistTitle, description, playlist.trackIds);
      Alert.alert('Saved', `"${playlist.playlistTitle}" added to your Apple Music library.`);
    } catch (error: any) {
      Alert.alert('Error', 'Failed to save playlist. Please try again.');
    }
  }, []);

  const handleTakeLive = useCallback(async (playlist: CuratedPlaylist) => {
    try {
      // Save first
      const description = `${playlist.playlistDescription} \u2014 Curated by ONAY`;
      const playlistId = await createPlaylist(playlist.playlistTitle, description, playlist.trackIds);

      // Create station
      const stationId = `curated-${Date.now()}`;
      const station = {
        id: stationId,
        name: playlist.playlistTitle,
        playlistId,
        defaultVibe: playlist.suggestedVibe,
        artworkUrl: playlist.tracks[0]?.artworkUrl,
        createdAt: new Date().toISOString(),
      };
      addStation(station);

      // Start broadcast with pre-sequenced queue (skip AI upgrade)
      await queueManager.initializeSession(playlistId, playlist.suggestedVibe, stationId, {
        skipAIUpgrade: true,
      });

      router.push({
        pathname: '/(main)/(broadcast)/player',
        params: {
          stationId,
          stationName: playlist.playlistTitle,
          vibe: playlist.suggestedVibe,
          playlistId,
        },
      });
    } catch (error: any) {
      Alert.alert('Error', 'Failed to start broadcast. Please try again.');
    }
  }, [router]);

  const renderMessage = useCallback(({ item }: { item: ChatMessage }) => {
    if (item.role === 'loading') {
      return (
        <View style={styles.loadingBubble}>
          <ActivityIndicator size="small" color={Colors.accent} />
          <Text style={styles.loadingText}>ONAY is curating...</Text>
        </View>
      );
    }

    if (item.role === 'error') {
      return (
        <View style={styles.errorBubble}>
          <Text style={styles.errorText}>{item.text}</Text>
          {originalPrompt && (
            <Pressable
              style={styles.retryButton}
              onPress={() => {
                setInputText(originalPrompt);
                handleSend();
              }}
              accessibilityLabel="Retry"
              accessibilityRole="button"
            >
              <Text style={styles.retryButtonText}>RETRY</Text>
            </Pressable>
          )}
        </View>
      );
    }

    if (item.role === 'user') {
      return (
        <View style={styles.userBubble}>
          <Text style={styles.userText}>{item.text}</Text>
        </View>
      );
    }

    if (item.role === 'onay') {
      return (
        <View style={styles.onayBubble}>
          <View style={styles.onayGoldEdge} />
          <Text style={styles.onayText}>{item.text}</Text>
        </View>
      );
    }

    if (item.role === 'playlist' && item.playlist) {
      return (
        <View style={styles.playlistCard}>
          <View style={styles.playlistGoldEdge} />
          <View style={styles.playlistInner}>
            <Text style={styles.playlistTitle}>{item.playlist.playlistTitle}</Text>
            <Text style={styles.playlistCount}>
              {item.playlist.tracks.length} TRACKS
            </Text>
            {item.playlist.tracks.map((track, idx) => (
              <View key={track.id} style={styles.trackRow}>
                <Text style={styles.trackNumber}>{idx + 1}</Text>
                {track.artworkUrl ? (
                  <Image source={{ uri: track.artworkUrl }} style={styles.trackArt} />
                ) : (
                  <View style={[styles.trackArt, styles.trackArtPlaceholder]} />
                )}
                <View style={styles.trackInfo}>
                  <Text style={styles.trackTitle} numberOfLines={1}>{track.title}</Text>
                  <Text style={styles.trackArtist} numberOfLines={1}>{track.artistName}</Text>
                </View>
              </View>
            ))}
            <View style={styles.actionRow}>
              <Pressable
                style={styles.actionButton}
                onPress={() => handleSave(item.playlist!)}
                accessibilityLabel="Save to Apple Music"
                accessibilityRole="button"
              >
                <Text style={styles.actionButtonText}>SAVE TO APPLE MUSIC</Text>
              </Pressable>
              <Pressable
                style={[styles.actionButton, styles.actionButtonPrimary]}
                onPress={() => handleTakeLive(item.playlist!)}
                accessibilityLabel="Take it live"
                accessibilityRole="button"
              >
                <Text style={[styles.actionButtonText, styles.actionButtonPrimaryText]}>
                  TAKE IT LIVE
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      );
    }

    return null;
  }, [handleSave, handleTakeLive, originalPrompt, handleSend]);

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={90}
    >
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          style={styles.backButton}
          accessibilityLabel="Go back"
          accessibilityRole="button"
        >
          <Text style={styles.backText}>{'\u2190'}</Text>
        </Pressable>
        <Text style={styles.headerLabel}>ONAY</Text>
      </View>

      <FlatList
        ref={flatListRef}
        data={messages}
        renderItem={renderMessage}
        keyExtractor={item => item.id}
        style={styles.messageList}
        contentContainerStyle={styles.messageListContent}
        onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
      />

      <View style={styles.inputBar}>
        <TextInput
          style={styles.input}
          value={inputText}
          onChangeText={setInputText}
          placeholder="What do you want to hear?"
          placeholderTextColor={TextColors.outline}
          returnKeyType="send"
          onSubmitEditing={handleSend}
          editable={!isGenerating}
        />
        <Pressable
          style={[styles.sendButton, isGenerating && styles.sendButtonDisabled]}
          onPress={handleSend}
          disabled={isGenerating}
          accessibilityLabel="Send message"
          accessibilityRole="button"
        >
          <Text style={styles.sendButtonText}>{'\u2191'}</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Surface.base,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.xl,
    paddingBottom: Spacing.sm,
  },
  backButton: {
    padding: Spacing.xs,
    marginRight: Spacing.sm,
  },
  backText: {
    color: TextColors.primary,
    fontSize: 24,
  },
  headerLabel: {
    fontFamily: Typography.mono.family,
    fontSize: 10,
    letterSpacing: 2.5,
    color: Colors.accent,
    textTransform: 'uppercase',
  },
  messageList: {
    flex: 1,
  },
  messageListContent: {
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  userBubble: {
    alignSelf: 'flex-end',
    backgroundColor: Surface.container,
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    maxWidth: '80%',
  },
  userText: {
    fontFamily: Typography.body.family,
    fontSize: 15,
    color: TextColors.primary,
  },
  onayBubble: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    maxWidth: '85%',
  },
  onayGoldEdge: {
    width: 2,
    backgroundColor: Colors.accent,
    borderRadius: 1,
    marginRight: Spacing.sm,
  },
  onayText: {
    fontFamily: Typography.cleoVoice.family,
    fontSize: 16,
    color: TextColors.primary,
    lineHeight: 24,
    flex: 1,
  },
  loadingBubble: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    alignSelf: 'flex-start',
    paddingVertical: Spacing.sm,
  },
  loadingText: {
    fontFamily: Typography.mono.family,
    fontSize: 10,
    letterSpacing: 2,
    color: Colors.accent,
    textTransform: 'uppercase',
  },
  errorBubble: {
    alignSelf: 'flex-start',
    backgroundColor: Surface.container,
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  errorText: {
    fontFamily: Typography.body.family,
    fontSize: 14,
    color: Colors.error,
  },
  playlistCard: {
    flexDirection: 'row',
    alignSelf: 'stretch',
    marginTop: Spacing.xs,
  },
  playlistGoldEdge: {
    width: 2,
    backgroundColor: Colors.accent,
    borderRadius: 1,
    marginRight: Spacing.sm,
  },
  playlistInner: {
    flex: 1,
    backgroundColor: Surface.container,
    borderRadius: Radius.sm,
    padding: Spacing.md,
  },
  playlistTitle: {
    fontFamily: Typography.display.family,
    fontSize: 18,
    color: TextColors.primary,
    marginBottom: Spacing.xs,
  },
  playlistCount: {
    fontFamily: Typography.mono.family,
    fontSize: 10,
    letterSpacing: 2,
    color: Colors.accent,
    marginBottom: Spacing.md,
  },
  trackRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    gap: Spacing.sm,
  },
  trackNumber: {
    fontFamily: Typography.mono.family,
    fontSize: 11,
    color: TextColors.outline,
    width: 20,
    textAlign: 'right',
  },
  trackArt: {
    width: 36,
    height: 36,
    borderRadius: Radius.sm,
  },
  trackArtPlaceholder: {
    backgroundColor: Surface.container,
  },
  trackInfo: {
    flex: 1,
  },
  trackTitle: {
    fontFamily: Typography.body.family,
    fontSize: 14,
    fontWeight: '500',
    color: TextColors.primary,
  },
  trackArtist: {
    fontFamily: Typography.body.family,
    fontSize: 12,
    color: TextColors.secondary,
  },
  actionRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginTop: Spacing.md,
  },
  actionButton: {
    flex: 1,
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: Colors.accent,
    paddingVertical: Spacing.sm,
    alignItems: 'center',
  },
  actionButtonPrimary: {
    backgroundColor: Colors.accent,
  },
  actionButtonText: {
    fontFamily: Typography.mono.family,
    fontSize: 10,
    letterSpacing: 1.5,
    color: Colors.accent,
  },
  actionButtonPrimaryText: {
    color: Surface.base,
  },
  retryButton: {
    marginTop: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.error,
    borderRadius: Radius.sm,
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.md,
    alignSelf: 'flex-start',
  },
  retryButtonText: {
    fontFamily: Typography.mono.family,
    fontSize: 10,
    letterSpacing: 1.5,
    color: Colors.error,
  },
  sendButtonDisabled: {
    opacity: 0.4,
  },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderTopWidth: 1,
    borderTopColor: Surface.container,
    gap: Spacing.sm,
  },
  input: {
    flex: 1,
    fontFamily: Typography.body.family,
    fontSize: 15,
    color: TextColors.primary,
    backgroundColor: Surface.container,
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    minHeight: 40,
  },
  sendButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonText: {
    color: Surface.base,
    fontSize: 18,
    fontWeight: '600',
  },
});
