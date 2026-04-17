import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  Alert,
  Animated,
  FlatList,
  KeyboardAvoidingView,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import auth from '@react-native-firebase/auth';
import { AM, Fonts, Space, TypeScale } from '../../tokens/design-tokens';
import { BroadcastBackdrop } from '../../components/BroadcastBackdrop';
import { AmberCTA } from '../../components/AmberCTA';
import { HairlineRow } from '../../components/HairlineRow';
import { curatePlaylist, refinePlaylist, CuratedPlaylist } from '../../engines/PlaylistCurator';
import { createPlaylist, authorize } from '../../../modules/expo-music-kit';
import { BroadcastCurationClient } from '../../engines/BroadcastCurationClient';
import { BroadcastManifestClient } from '../../engines/BroadcastManifestClient';
import { broadcastPlayer } from '../../engines/BroadcastPlayer.singleton';
import { isCurator } from '../../config/curators';

type MessageRole = 'user' | 'onay' | 'playlist' | 'loading' | 'error';

interface ChatMessage {
  id: string;
  role: MessageRole;
  text?: string;
  playlist?: CuratedPlaylist;
}

// ─────────────────────────── Typing indicator ───────────────────────────

function TypingIndicator() {
  const dots = [useRef(new Animated.Value(0.3)).current,
                useRef(new Animated.Value(0.3)).current,
                useRef(new Animated.Value(0.3)).current];

  useEffect(() => {
    const animate = (dot: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(dot, { toValue: 1, duration: 300, useNativeDriver: true }),
          Animated.timing(dot, { toValue: 0.3, duration: 300, useNativeDriver: true }),
          Animated.delay(600 - delay),
        ]),
      );
    const loops = [animate(dots[0], 0), animate(dots[1], 200), animate(dots[2], 400)];
    loops.forEach(l => l.start());
    return () => loops.forEach(l => l.stop());
  }, [dots]);

  return (
    <View style={styles.typingWrap}>
      {dots.map((dot, i) => (
        <Animated.View key={i} style={[styles.typingDot, { opacity: dot }]} />
      ))}
    </View>
  );
}

// ────────────────────────────── Screen ─────────────────────────────────

export function AskOnayScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ suggestion?: string }>();
  const insets = useSafeAreaInsets();
  const inputRef = useRef<TextInput>(null);
  const flatListRef = useRef<FlatList>(null);
  const messageIdCounter = useRef(1);

  const [messages, setMessages] = useState<ChatMessage[]>([
    { id: 'welcome', role: 'onay', text: 'What kind of playlist are you in the mood for?' },
  ]);
  const [inputText, setInputText] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [currentPlaylist, setCurrentPlaylist] = useState<CuratedPlaylist | null>(null);
  const [originalPrompt, setOriginalPrompt] = useState('');
  const [publishing, setPublishing] = useState(false);

  const canCurate = isCurator(auth().currentUser?.email);

  const nextId = () => String(messageIdCounter.current++);

  // Declared above first consumer so hoisting is legal for both TS and humans.
  const addMessage = useCallback((msg: Omit<ChatMessage, 'id'>) => {
    const id = nextId();
    setMessages(prev => [...prev, { ...msg, id }]);
    return id;
  }, []);

  const removeMessage = useCallback((id: string) => {
    setMessages(prev => prev.filter(m => m.id !== id));
  }, []);

  const checkGuards = useCallback(async (): Promise<boolean> => {
    const state = broadcastPlayer.getStatus().state;
    if (state !== 'idle' && state !== 'ended') {
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

  const executeCuration = useCallback(async (prompt: string) => {
    addMessage({ role: 'user', text: prompt });

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
    addMessage({ role: 'onay', text: teaser });

    setIsGenerating(true);
    const loadingId = addMessage({ role: 'loading' });
    try {
      setOriginalPrompt(prompt);
      const result = await curatePlaylist({ prompt });
      removeMessage(loadingId);
      setCurrentPlaylist(result);
      addMessage({ role: 'onay', text: result.conversationalResponse });
      addMessage({ role: 'playlist', playlist: result });
    } catch (err: any) {
      removeMessage(loadingId);
      addMessage({ role: 'error', text: err?.message || 'Something went wrong.' });
    } finally {
      setIsGenerating(false);
    }
  }, [addMessage, removeMessage]);

  // Pre-filled suggestion from Home's "ONAY suggests" (legacy entry point)
  const pendingSuggestionRef = useRef<string | null>(null);
  useEffect(() => {
    if (!params.suggestion) return;
    try {
      const suggestion = JSON.parse(params.suggestion);
      pendingSuggestionRef.current = suggestion.playlistTitle;
    } catch {}
  }, [params.suggestion]);

  useEffect(() => {
    if (!pendingSuggestionRef.current || isGenerating) return;
    const prompt = pendingSuggestionRef.current;
    pendingSuggestionRef.current = null;
    setInputText(prompt);
    (async () => {
      if (!(await checkGuards())) return;
      await executeCuration(prompt);
    })();
  }, [checkGuards, executeCuration, isGenerating]);

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
        result = await refinePlaylist(
          {
            userFeedback: text,
            existingTracks: currentPlaylist.tracks.map(t => ({
              title: t.title,
              artist: t.artistName,
            })),
          },
          originalPrompt,
          currentPlaylist.suggestedVibe,
        );
      } else {
        setOriginalPrompt(text);
        result = await curatePlaylist({ prompt: text });
      }

      removeMessage(loadingId);
      setCurrentPlaylist(result);
      addMessage({ role: 'onay', text: result.conversationalResponse });
      addMessage({ role: 'playlist', playlist: result });
    } catch (err: any) {
      removeMessage(loadingId);
      addMessage({ role: 'error', text: err?.message || 'Something went wrong. Try again.' });
    } finally {
      setIsGenerating(false);
    }
  }, [inputText, isGenerating, currentPlaylist, originalPrompt, addMessage, removeMessage, checkGuards]);

  const handleRefineChip = useCallback(async (text: string) => {
    if (isGenerating || !currentPlaylist) return;
    if (!(await checkGuards())) return;

    setInputText('');
    addMessage({ role: 'user', text });

    setIsGenerating(true);
    const loadingId = addMessage({ role: 'loading' });
    try {
      const result = await refinePlaylist(
        {
          userFeedback: text,
          existingTracks: currentPlaylist.tracks.map(t => ({
            title: t.title,
            artist: t.artistName,
          })),
        },
        originalPrompt,
        currentPlaylist.suggestedVibe,
      );
      removeMessage(loadingId);
      setCurrentPlaylist(result);
      addMessage({ role: 'onay', text: result.conversationalResponse });
      addMessage({ role: 'playlist', playlist: result });
    } catch (err: any) {
      removeMessage(loadingId);
      addMessage({ role: 'error', text: err?.message || 'Something went wrong. Try again.' });
    } finally {
      setIsGenerating(false);
    }
  }, [isGenerating, currentPlaylist, originalPrompt, addMessage, removeMessage, checkGuards]);

  const handleSave = useCallback(async (playlist: CuratedPlaylist) => {
    try {
      const description = `${playlist.playlistDescription} \u2014 Curated by ONAY`;
      await createPlaylist(playlist.playlistTitle, description, playlist.trackIds);
      Alert.alert('Saved', `"${playlist.playlistTitle}" added to your Apple Music library.`);
    } catch {
      Alert.alert('Error', 'Failed to save playlist. Please try again.');
    }
  }, []);

  const handleTakeLive = useCallback(async (playlist: CuratedPlaylist) => {
    try {
      const client = new BroadcastManifestClient();
      const now = new Date();
      const count = playlist.trackIds.length;
      const length: 'quick' | 'standard' | 'long' =
        count >= 15 ? 'long' : count >= 9 ? 'standard' : 'quick';

      const { manifest, firstSegmentUrls } = await client.createBroadcast({
        playlistId: `curated-${Date.now()}`,
        vibe: playlist.suggestedVibe,
        length,
        userContext: {
          timeOfDay: now.toTimeString().slice(0, 5),
          dayOfWeek: now.toLocaleDateString(undefined, { weekday: 'long' }),
          firstTimeUser: false,
        },
        tracks: playlist.tracks.slice(0, 20).map(t => ({
          id: t.id,
          title: t.title,
          artistName: t.artistName,
          albumTitle: t.albumTitle ?? '',
          duration: t.duration ?? 180,
          artworkUrl: t.artworkUrl,
        })),
      });

      router.push('/(main)/(broadcast)/player');
      broadcastPlayer.start(manifest, firstSegmentUrls).catch((e: unknown) => {
        console.warn('[AskOnay] take-live playback failed', e);
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to start broadcast. Please try again.';
      Alert.alert('Broadcast unavailable', msg);
    }
  }, [router]);

  const handlePublishFeatured = useCallback(async (playlist: CuratedPlaylist) => {
    if (publishing) return;
    const count = playlist.trackIds.length;
    const length: 'quick' | 'standard' | 'long' =
      count >= 15 ? 'long' : count >= 9 ? 'standard' : 'quick';

    Alert.prompt?.(
      'Publish as Tonight on ONAY',
      'This will bake the broadcast and show it on every user\u2019s home screen. Confirm the title:',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Publish',
          onPress: async (titleOverride?: string) => {
            const title = (titleOverride && titleOverride.trim().length > 0)
              ? titleOverride.trim()
              : playlist.playlistTitle;
            setPublishing(true);
            try {
              const client = new BroadcastCurationClient();
              const slug = `${Date.now()}-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)}`;
              await client.publishFeatured({
                id: slug,
                title,
                description: playlist.playlistDescription,
                vibe: playlist.suggestedVibe,
                length,
                artworkUrl: playlist.tracks[0]?.artworkUrl,
                tracks: playlist.tracks.map(t => ({
                  id: t.id,
                  title: t.title,
                  artistName: t.artistName,
                  albumTitle: t.albumTitle ?? '',
                  duration: t.duration ?? 180,
                  artworkUrl: t.artworkUrl,
                })),
              });
              Alert.alert('Published', `"${title}" is now on Tonight on ONAY.`);
            } catch (err) {
              const msg = err instanceof Error ? err.message : 'Publish failed.';
              Alert.alert('Publish failed', msg);
            } finally {
              setPublishing(false);
            }
          },
        },
      ],
      'plain-text',
      playlist.playlistTitle,
    );
  }, [publishing]);

  const handleNewPlaylist = useCallback(() => {
    setCurrentPlaylist(null);
    setOriginalPrompt('');
    addMessage({
      role: 'onay',
      text: 'Alright, clean slate. What are we building next?',
    });
  }, [addMessage]);

  // ──────────────────────────── Render ────────────────────────────

  const renderMessage = useCallback(({ item }: { item: ChatMessage }) => {
    if (item.role === 'loading') return <TypingIndicator />;

    if (item.role === 'error') {
      return (
        <View style={styles.errorBlock}>
          <Text style={styles.errorText}>{item.text}</Text>
          {originalPrompt ? (
            <Pressable
              onPress={async () => {
                if (!(await checkGuards())) return;
                await executeCuration(originalPrompt);
              }}
              accessibilityRole="button"
              accessibilityLabel="Retry"
              style={({ pressed }) => [styles.retryBtn, pressed && { opacity: 0.6 }]}
            >
              <Text style={styles.retryText}>retry</Text>
            </Pressable>
          ) : null}
        </View>
      );
    }

    if (item.role === 'user') {
      return (
        <View style={styles.userWrap}>
          <Text style={styles.userText}>{item.text}</Text>
        </View>
      );
    }

    if (item.role === 'onay') {
      return (
        <View style={styles.onayWrap}>
          <Text style={styles.onayLabel}>ONAY</Text>
          <Text style={styles.onayText}>{item.text}</Text>
        </View>
      );
    }

    if (item.role === 'playlist' && item.playlist) {
      const pl = item.playlist;
      return (
        <View style={styles.playlistWrap}>
          <Text style={styles.playlistTitle}>{pl.playlistTitle}</Text>
          <Text style={styles.playlistMeta}>{pl.tracks.length} tracks</Text>
          <View style={{ marginTop: Space.s10 }}>
            {pl.tracks.map((track, idx) => (
              <HairlineRow
                key={track.id}
                topRule={idx === 0}
                verticalPadding={Space.s10}
                leading={<Text style={styles.trackNum}>{String(idx + 1).padStart(2, '0')}</Text>}
                leadingWidth={28}
                value={
                  <View>
                    <Text style={styles.trackTitle} numberOfLines={1}>{track.title}</Text>
                    <Text style={styles.trackArtist} numberOfLines={1}>{track.artistName}</Text>
                  </View>
                }
              />
            ))}
          </View>

          <View style={{ height: Space.s22 }} />
          <AmberCTA
            label="Take it live"
            onPress={() => handleTakeLive(pl)}
            accessibilityHint="Bake and play this as a broadcast"
          />

          <Pressable
            onPress={() => handleSave(pl)}
            accessibilityRole="button"
            accessibilityLabel="Save to Apple Music"
            style={({ pressed }) => [styles.secondary, pressed && { opacity: 0.6 }]}
          >
            <Text style={styles.secondaryText}>save to apple music</Text>
          </Pressable>

          {canCurate && (
            <Pressable
              onPress={() => handlePublishFeatured(pl)}
              disabled={publishing}
              accessibilityRole="button"
              accessibilityLabel="Publish as Tonight on ONAY"
              style={({ pressed }) => [styles.secondary, pressed && { opacity: 0.6 }]}
            >
              <Text style={styles.secondaryText}>
                {publishing ? 'publishing\u2026' : 'publish as tonight on onay'}
              </Text>
              <Text style={styles.curatorOnly}>curator only</Text>
            </Pressable>
          )}

          <View style={styles.refineBlock}>
            <Text style={styles.refineLabel}>REFINE</Text>
            <View style={styles.refineChips}>
              {['more upbeat', 'more chill', 'longer', 'shorter', 'more variety'].map(s => (
                <Pressable
                  key={s}
                  onPress={() => handleRefineChip(s)}
                  disabled={isGenerating}
                  accessibilityRole="button"
                  accessibilityLabel={`Refine: ${s}`}
                  style={({ pressed }) => [styles.chip, pressed && { opacity: 0.6 }]}
                >
                  <Text style={styles.chipText}>{s}</Text>
                </Pressable>
              ))}
            </View>
          </View>

          <Pressable
            onPress={handleNewPlaylist}
            accessibilityRole="button"
            accessibilityLabel="Start a new playlist"
            style={({ pressed }) => [styles.newBtn, pressed && { opacity: 0.6 }]}
          >
            <Text style={styles.newBtnText}>new playlist</Text>
          </Pressable>
        </View>
      );
    }

    return null;
  }, [
    canCurate,
    checkGuards,
    executeCuration,
    handleNewPlaylist,
    handlePublishFeatured,
    handleRefineChip,
    handleSave,
    handleTakeLive,
    isGenerating,
    originalPrompt,
    publishing,
  ]);

  return (
    <BroadcastBackdrop>
      <KeyboardAvoidingView
        style={[styles.flex, { paddingTop: insets.top }]}
        behavior="padding"
        keyboardVerticalOffset={0}
      >
        {/* Header */}
        <View style={styles.header}>
          <Pressable
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel="Go back"
            hitSlop={12}
          >
            <Text style={styles.backText}>{'\u2190'}</Text>
          </Pressable>
          <Text style={styles.headerWordmark}>ask onay</Text>
          <View style={{ width: 20 }} />
        </View>

        <FlatList
          ref={flatListRef}
          data={messages}
          renderItem={renderMessage}
          keyExtractor={item => item.id}
          style={styles.list}
          contentContainerStyle={styles.listContent}
          onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
        />

        <View style={[styles.inputBar, { paddingBottom: Math.max(insets.bottom, Space.s10) }]}>
          <TextInput
            ref={inputRef}
            style={styles.input}
            value={inputText}
            onChangeText={setInputText}
            placeholder={currentPlaylist ? 'refine it\u2026' : 'what do you want to hear?'}
            placeholderTextColor={AM.inkDim}
            returnKeyType="send"
            onSubmitEditing={handleSend}
            editable={!isGenerating}
            autoFocus
            multiline
            maxLength={500}
            blurOnSubmit={false}
          />
          <Pressable
            onPress={handleSend}
            disabled={isGenerating || !inputText.trim()}
            accessibilityRole="button"
            accessibilityLabel="Send message"
            style={({ pressed }) => [
              styles.sendBtn,
              (!inputText.trim() || isGenerating) && styles.sendBtnDisabled,
              pressed && { opacity: 0.6 },
            ]}
          >
            <Text style={styles.sendText}>send {'\u203A'}</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </BroadcastBackdrop>
  );
}

// ────────────────────────────── Styles ─────────────────────────────────

const styles = StyleSheet.create({
  flex: { flex: 1 },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Space.s26,
    paddingTop: Space.s10,
    paddingBottom: Space.s18,
    borderBottomWidth: 1,
    borderBottomColor: AM.amberFaint,
  },
  backText: {
    color: AM.inkMid,
    fontFamily: Fonts.display,
    fontSize: TypeScale.s22,
  },
  headerWordmark: {
    fontFamily: Fonts.mono,
    fontSize: TypeScale.s10,
    letterSpacing: 3,
    color: AM.amberDim,
  },

  // Message list
  list: { flex: 1 },
  listContent: {
    paddingHorizontal: Space.s26,
    paddingTop: Space.s22,
    paddingBottom: Space.s22,
    gap: Space.s18,
  },

  // ONAY messages — italic serif, left-aligned
  onayWrap: {
    alignSelf: 'flex-start',
    maxWidth: '92%',
    gap: Space.s6,
  },
  onayLabel: {
    fontFamily: Fonts.mono,
    fontSize: TypeScale.s10,
    letterSpacing: 2.5,
    color: AM.amberDim,
  },
  onayText: {
    fontFamily: Fonts.display,
    fontSize: TypeScale.s16,
    fontStyle: 'italic',
    color: AM.ink,
    lineHeight: TypeScale.s16 * 1.5,
  },

  // User messages — mono, right-aligned, subdued
  userWrap: {
    alignSelf: 'flex-end',
    maxWidth: '80%',
  },
  userText: {
    fontFamily: Fonts.mono,
    fontSize: TypeScale.s13,
    color: AM.inkMid,
    letterSpacing: 0.5,
    textAlign: 'right',
    lineHeight: TypeScale.s13 * 1.5,
  },

  // Error
  errorBlock: {
    alignSelf: 'flex-start',
    paddingTop: Space.s10,
    paddingBottom: Space.s10,
    borderTopWidth: 1,
    borderTopColor: AM.amberFaint,
    gap: Space.s8,
  },
  errorText: {
    fontFamily: Fonts.display,
    fontSize: TypeScale.s16,
    fontStyle: 'italic',
    color: AM.ink,
  },
  retryBtn: { alignSelf: 'flex-start' },
  retryText: {
    fontFamily: Fonts.mono,
    fontSize: TypeScale.s10,
    letterSpacing: 2,
    color: AM.amber,
  },

  // Typing dots
  typingWrap: {
    flexDirection: 'row',
    alignSelf: 'flex-start',
    gap: Space.s4,
    paddingVertical: Space.s8,
  },
  typingDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: AM.amber,
  },

  // Playlist card — no bubble, just a sectioned block
  playlistWrap: {
    marginTop: Space.s10,
  },
  playlistTitle: {
    fontFamily: Fonts.display,
    fontSize: TypeScale.s22,
    fontStyle: 'italic',
    color: AM.ink,
  },
  playlistMeta: {
    marginTop: Space.s6,
    fontFamily: Fonts.mono,
    fontSize: TypeScale.s10,
    letterSpacing: 2,
    color: AM.amberDim,
  },
  trackNum: {
    fontFamily: Fonts.mono,
    fontSize: TypeScale.s10,
    letterSpacing: 1,
    color: AM.amberDim,
  },
  trackTitle: {
    fontFamily: Fonts.display,
    fontSize: TypeScale.s16,
    fontStyle: 'italic',
    color: AM.ink,
  },
  trackArtist: {
    marginTop: 2,
    fontFamily: Fonts.mono,
    fontSize: TypeScale.s10,
    letterSpacing: 1,
    color: AM.inkDim,
  },

  // Secondary action text buttons
  secondary: {
    alignItems: 'center',
    paddingVertical: Space.s14,
  },
  secondaryText: {
    fontFamily: Fonts.mono,
    fontSize: TypeScale.s10,
    letterSpacing: 2,
    color: AM.amber,
  },
  curatorOnly: {
    marginTop: Space.s4,
    fontFamily: Fonts.mono,
    fontSize: TypeScale.s9,
    letterSpacing: 2,
    color: AM.inkDim,
  },

  // Refine
  refineBlock: {
    marginTop: Space.s22,
    paddingTop: Space.s14,
    borderTopWidth: 1,
    borderTopColor: AM.amberFaint,
  },
  refineLabel: {
    fontFamily: Fonts.mono,
    fontSize: TypeScale.s10,
    letterSpacing: 2,
    color: AM.inkDim,
    marginBottom: Space.s10,
  },
  refineChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Space.s8,
  },
  chip: {
    borderWidth: 1,
    borderColor: AM.amberFaint,
    paddingHorizontal: Space.s14,
    paddingVertical: Space.s8,
  },
  chipText: {
    fontFamily: Fonts.mono,
    fontSize: TypeScale.s10,
    letterSpacing: 1.5,
    color: AM.inkMid,
  },

  newBtn: {
    alignItems: 'center',
    paddingVertical: Space.s14,
  },
  newBtnText: {
    fontFamily: Fonts.mono,
    fontSize: TypeScale.s10,
    letterSpacing: 2,
    color: AM.inkDim,
  },

  // Input bar
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: Space.s22,
    paddingTop: Space.s10,
    gap: Space.s14,
    borderTopWidth: 1,
    borderTopColor: AM.amberFaint,
  },
  input: {
    flex: 1,
    fontFamily: Fonts.display,
    fontSize: TypeScale.s16,
    fontStyle: 'italic',
    color: AM.ink,
    paddingVertical: Space.s10,
    paddingHorizontal: 0,
    minHeight: 40,
    maxHeight: 120,
  },
  sendBtn: {
    paddingVertical: Space.s10,
  },
  sendBtnDisabled: {
    opacity: 0.35,
  },
  sendText: {
    fontFamily: Fonts.mono,
    fontSize: TypeScale.s10,
    letterSpacing: 2,
    color: AM.amber,
  },
});

export default AskOnayScreen;
