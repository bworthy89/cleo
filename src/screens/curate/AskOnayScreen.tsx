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
  Animated,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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

function TypingIndicator() {
  const dot1 = useRef(new Animated.Value(0.3)).current;
  const dot2 = useRef(new Animated.Value(0.3)).current;
  const dot3 = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    const animate = (dot: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(dot, { toValue: 1, duration: 300, useNativeDriver: true }),
          Animated.timing(dot, { toValue: 0.3, duration: 300, useNativeDriver: true }),
          Animated.delay(600 - delay),
        ])
      );

    const a1 = animate(dot1, 0);
    const a2 = animate(dot2, 200);
    const a3 = animate(dot3, 400);
    a1.start();
    a2.start();
    a3.start();

    return () => { a1.stop(); a2.stop(); a3.stop(); };
  }, []);

  return (
    <View style={typingStyles.container}>
      <View style={typingStyles.goldEdge} />
      <View style={typingStyles.bubble}>
        {[dot1, dot2, dot3].map((dot, i) => (
          <Animated.View key={i} style={[typingStyles.dot, { opacity: dot }]} />
        ))}
      </View>
    </View>
  );
}

const typingStyles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignSelf: 'flex-start',
  },
  goldEdge: {
    width: 2,
    backgroundColor: Colors.accent,
    borderRadius: 1,
    marginRight: Spacing.sm,
  },
  bubble: {
    flexDirection: 'row',
    backgroundColor: Surface.container,
    borderRadius: 18,
    borderBottomLeftRadius: 4,
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 5,
    alignItems: 'center',
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.accent,
  },
});

export function AskOnayScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ suggestion?: string }>();
  const insets = useSafeAreaInsets();
  const inputRef = useRef<TextInput>(null);
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

  // Shared guard: checks broadcast and subscription before curation
  const checkGuards = useCallback(async (): Promise<boolean> => {
    const activeSession = sessionEngine.getSession();
    if (activeSession) {
      addMessage({
        role: 'error',
        text: 'Playlist curation is unavailable during an active broadcast. End your session first.',
      });
      return false;
    }
    const authResult = await authorize();
    if (!authResult.canPlayCatalog) {
      addMessage({
        role: 'error',
        text: 'An Apple Music subscription is required to create playlists. Please subscribe in the Music app.',
      });
      return false;
    }
    return true;
  }, [addMessage]);

  // Shared curation logic for both handleSend and suggestion/retry paths
  const executeCuration = useCallback(async (prompt: string) => {
    addMessage({ role: 'user', text: prompt });

    // Instant response before the typing indicator
    const teasers = [
      'Let me dig in the crates for you\u2026',
      'I know just the vibe. Give me a second\u2026',
      'Oh, I\u2019ve been waiting for this one\u2026',
      'Say less. I\u2019m on it\u2026',
      'Pulling from the archives\u2026',
      'I\u2019ve got something special in mind\u2026',
      'This is going to be good. Hold on\u2026',
      'Let me curate something worth your time\u2026',
      'I see where you\u2019re going with this\u2026',
      'Already hearing it in my head\u2026',
    ];
    const teaser = teasers[Math.floor(Math.random() * teasers.length)];
    addMessage({ role: 'onay', text: `\u201C${teaser}\u201D` });

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
  }, [addMessage, removeMessage]);

  // Auto-send when pending suggestion is set (runs after mount)
  useEffect(() => {
    if (pendingSuggestionRef.current && !isGenerating) {
      const prompt = pendingSuggestionRef.current;
      pendingSuggestionRef.current = null;
      setInputText(prompt);
      (async () => {
        if (!(await checkGuards())) return;
        await executeCuration(prompt);
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

    if (!(await checkGuards())) return;

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
      return <TypingIndicator />;
    }

    if (item.role === 'error') {
      return (
        <View style={styles.errorBubble}>
          <Text style={styles.errorText}>{item.text}</Text>
          {originalPrompt && (
            <Pressable
              style={styles.retryButton}
              onPress={async () => {
                if (!(await checkGuards())) return;
                await executeCuration(originalPrompt);
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
  }, [handleSave, handleTakeLive, originalPrompt, checkGuards, executeCuration]);

  return (
    <KeyboardAvoidingView
      style={[styles.container, { paddingTop: insets.top }]}
      behavior="padding"
      keyboardVerticalOffset={0}
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
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
      />

      <View style={[styles.inputBar, { paddingBottom: Math.max(insets.bottom, Spacing.sm) }]}>
        <TextInput
          ref={inputRef}
          style={styles.input}
          value={inputText}
          onChangeText={setInputText}
          placeholder={currentPlaylist ? "Refine it\u2026 \u201Cmore upbeat\u201D, \u201Cswap the Coldplay\u201D" : "What do you want to hear?"}
          placeholderTextColor={TextColors.outline}
          returnKeyType="send"
          onSubmitEditing={handleSend}
          editable={!isGenerating}
          autoFocus
          multiline
          maxLength={500}
          blurOnSubmit={false}
        />
        <Pressable
          style={[
            styles.sendButton,
            (!inputText.trim() || isGenerating) && styles.sendButtonDisabled,
          ]}
          onPress={handleSend}
          disabled={isGenerating || !inputText.trim()}
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
    backgroundColor: Colors.accent,
    borderRadius: 18,
    borderBottomRightRadius: 4,
    paddingHorizontal: 14,
    paddingVertical: 10,
    maxWidth: '80%',
  },
  userText: {
    fontFamily: Typography.body.family,
    fontSize: 16,
    color: '#FFFFFF',
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
    fontStyle: Typography.cleoVoice.style,
    fontSize: 16,
    color: TextColors.primary,
    lineHeight: 24,
    flex: 1,
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
    backgroundColor: Surface.high,
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
    alignItems: 'flex-end',
    paddingHorizontal: Spacing.sm,
    paddingTop: Spacing.sm,
    backgroundColor: Surface.base,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Surface.bright,
    gap: Spacing.xs,
  },
  input: {
    flex: 1,
    fontFamily: Typography.body.family,
    fontSize: 16,
    color: TextColors.primary,
    backgroundColor: Surface.container,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Surface.bright,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 10,
    minHeight: 40,
    maxHeight: 120,
  },
  hiddenInput: {
    position: 'absolute',
    opacity: 0,
    height: 0,
  },
  sendButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: Colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 3,
  },
  sendButtonText: {
    color: Surface.base,
    fontSize: 16,
    fontWeight: '700',
  },
});
