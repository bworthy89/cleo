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
import { StampButton, SectionMarker, LinerNotes, SleeveArt, Tick, SettingsCog } from '../../components/crate';
import { curatePlaylist, refinePlaylist, CuratedPlaylist } from '../../engines/PlaylistCurator';
import { createPlaylist, authorize } from '../../../modules/expo-music-kit';
import { BroadcastCurationClient } from '../../engines/BroadcastCurationClient';
import { BroadcastManifestClient } from '../../engines/BroadcastManifestClient';
import { broadcastPlayer } from '../../engines/BroadcastPlayer.singleton';
import { isCurator } from '../../config/curators';
import { useAppActive } from '../../hooks/useAppActive';

type MessageRole = 'user' | 'onay' | 'playlist' | 'loading' | 'error';

interface ChatMessage {
  id: string;
  role: MessageRole;
  text?: string;
  playlist?: CuratedPlaylist;
}

// ─────────────────────── Tonearm "thinking" indicator ───────────────────────

function TonearmThinking() {
  const sway = useRef(new Animated.Value(0)).current;
  const appActive = useAppActive();
  useEffect(() => {
    if (!appActive) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(sway, { toValue: 1, duration: 1400, useNativeDriver: true }),
        Animated.timing(sway, { toValue: 0, duration: 1400, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [appActive, sway]);
  const rot = sway.interpolate({ inputRange: [0, 1], outputRange: ['-3deg', '6deg'] });

  return (
    <View style={styles.thinkRow}>
      <Animated.View style={{
        width: 40, height: 18, transform: [{ rotate: rot }],
        transformOrigin: '100% 50%',
        flexDirection: 'row', alignItems: 'center',
      }}>
        <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: AM.amber }} />
        <View style={{ flex: 1, height: 1.2, backgroundColor: AM.amber }} />
        <View style={{ width: 3, height: 3, borderRadius: 1.5, backgroundColor: AM.oxblood }} />
      </Animated.View>
      <Text style={styles.thinkLabel}>FLIPPING THROUGH THE CRATES…</Text>
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

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [currentPlaylist, setCurrentPlaylist] = useState<CuratedPlaylist | null>(null);
  const [originalPrompt, setOriginalPrompt] = useState('');
  const [publishing, setPublishing] = useState(false);

  const canCurate = isCurator(auth().currentUser?.email);

  const nextId = () => String(messageIdCounter.current++);

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

  const handleSteer = useCallback(async (option: string) => {
    if (isGenerating || !currentPlaylist) return;
    if (!(await checkGuards())) return;
    setInputText('');
    addMessage({ role: 'user', text: option });
    setIsGenerating(true);
    const loadingId = addMessage({ role: 'loading' });
    try {
      const result = await refinePlaylist(
        {
          userFeedback: option,
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
      const description = `${playlist.playlistDescription} — Curated by ONAY`;
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
      'This will bake the broadcast and show it on every user’s home screen. Confirm the title:',
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
    setMessages([]);
  }, []);

  // ──────────────────────────── Render ────────────────────────────

  const renderMessage = useCallback(({ item }: { item: ChatMessage }) => {
    if (item.role === 'loading') return <TonearmThinking />;

    if (item.role === 'error') {
      return (
        <View style={styles.errorBlock}>
          <Text style={styles.errorHeader}>A HITCH —</Text>
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
              <Text style={styles.retryText}>TRY AGAIN →</Text>
            </Pressable>
          ) : null}
        </View>
      );
    }

    if (item.role === 'user') {
      return (
        <View style={styles.requestBlock}>
          <Text style={styles.requestHeader}>YOU ASKED —</Text>
          <Text style={styles.requestText}>&ldquo;{item.text}&rdquo;</Text>
        </View>
      );
    }

    if (item.role === 'onay') {
      return (
        <View style={styles.onayWrap}>
          <Text style={styles.onayLabel}>ONAY&rsquo;S TAKE —</Text>
          <Text style={styles.onayText}>{item.text}</Text>
        </View>
      );
    }

    if (item.role === 'playlist' && item.playlist) {
      const pl = item.playlist;
      const sleeves = pl.tracks.slice(0, 5);
      const remaining = Math.max(0, pl.tracks.length - sleeves.length);
      const totalMin = Math.round(pl.tracks.reduce((a, t) => a + (t.duration ?? 180), 0) / 60);

      return (
        <View>
          {/* Stance / angle */}
          {pl.stance ? (
            <View style={styles.stance}>
              <Text style={styles.stanceHeader}>ONAY&rsquo;S ANGLE —</Text>
              <Text style={styles.stanceText}>{pl.stance}</Text>
            </View>
          ) : null}

          {/* Plate */}
          <View style={styles.plate}>
            <Tick pos="tl" color={AM.ruleStrong} bg={AM.bg} />
            <Tick pos="tr" color={AM.ruleStrong} bg={AM.bg} />
            <Tick pos="bl" color={AM.ruleStrong} bg={AM.bg} />
            <Tick pos="br" color={AM.ruleStrong} bg={AM.bg} />

            <View style={styles.plateHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.plateKicker}>ONAY&rsquo;S PICK · DRAFT I</Text>
                <Text style={styles.plateTitle} numberOfLines={2}>
                  {pl.playlistTitle.toUpperCase()}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={styles.plateMetaMono}>
                  {pl.tracks.length.toString().padStart(2, '0')} TRACKS
                </Text>
                <Text style={styles.plateMetaMono}>{totalMin} MIN</Text>
              </View>
            </View>

            {/* Sleeve preview row */}
            <View style={styles.sleeveRow}>
              {sleeves.map((t, i) => (
                <SleeveArt
                  key={t.id}
                  title={t.title}
                  artist={t.artistName}
                  size={46}
                  artworkUrl={t.artworkUrl}
                />
              ))}
              {remaining > 0 && (
                <View style={styles.sleeveMore}>
                  <Text style={styles.sleeveMoreText}>+{remaining}</Text>
                </View>
              )}
            </View>

            {/* Track list — catalog */}
            <View>
              {pl.tracks.map((t, i) => (
                <View
                  key={t.id}
                  style={[styles.trackRow, i < pl.tracks.length - 1 && styles.trackRowDot]}
                >
                  <Text style={styles.trackNum}>{String(i + 1).padStart(2, '0')}</Text>
                  <View style={styles.trackMid}>
                    <Text style={styles.trackTitle} numberOfLines={1}>
                      {t.title.toUpperCase()}
                    </Text>
                    <Text style={styles.trackArtist} numberOfLines={1}>{t.artistName}</Text>
                  </View>
                  <Text style={styles.trackYear}>
                    {(t.albumTitle || '').slice(0, 10).toUpperCase() || '—'}
                  </Text>
                </View>
              ))}
            </View>
          </View>

          {/* Take it live */}
          <View style={{ marginTop: Space.s18 }}>
            <StampButton
              label="TAKE IT LIVE"
              sub="BEGIN BROADCASTING"
              onPress={() => handleTakeLive(pl)}
              accessibilityHint="Bake and play this as a broadcast"
            />
          </View>

          {/* Secondary actions */}
          <View style={styles.secondaryGrid}>
            <Pressable
              onPress={() => handleSave(pl)}
              accessibilityRole="button"
              accessibilityLabel="Save to Apple Music"
              style={({ pressed }) => [styles.secondary, pressed && { opacity: 0.6 }]}
            >
              <Text style={styles.secondaryText}>SAVE TO APPLE MUSIC</Text>
            </Pressable>
            <Pressable
              onPress={handleNewPlaylist}
              accessibilityRole="button"
              accessibilityLabel="Another pass"
              style={({ pressed }) => [styles.secondary, pressed && { opacity: 0.6 }]}
            >
              <Text style={styles.secondaryText}>ANOTHER PASS</Text>
            </Pressable>
          </View>

          {canCurate && (
            <Pressable
              onPress={() => handlePublishFeatured(pl)}
              disabled={publishing}
              accessibilityRole="button"
              accessibilityLabel="Publish as Tonight on ONAY"
              style={({ pressed }) => [styles.curatorBtn, pressed && { opacity: 0.6 }]}
            >
              <Text style={styles.curatorText}>
                {publishing ? 'PUBLISHING…' : 'PUBLISH AS TONIGHT ON ONAY'}
              </Text>
              <Text style={styles.curatorOnly}>CURATOR ONLY</Text>
            </Pressable>
          )}

          {/* Steering */}
          {pl.options && pl.options.length > 0 && (
            <>
              <SectionMarker num="B·04" title="A DIFFERENT ANGLE" side="STEER" />
              <View style={{ gap: 2 }}>
                {pl.options.map(opt => (
                  <Pressable
                    key={opt}
                    onPress={() => handleSteer(opt)}
                    disabled={isGenerating}
                    accessibilityRole="button"
                    accessibilityLabel={`Steer: ${opt}`}
                    style={({ pressed }) => [styles.steerRow, pressed && { opacity: 0.6 }]}
                  >
                    <Text style={styles.steerText}>&ldquo;{opt}&rdquo;</Text>
                    <Text style={styles.steerArrow}>→</Text>
                  </Pressable>
                ))}
              </View>
            </>
          )}
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
    handleSave,
    handleSteer,
    handleTakeLive,
    isGenerating,
    originalPrompt,
    publishing,
  ]);

  const headerComponent = (
    <View>
      <View style={styles.greeting}>
        <LinerNotes>
          Tell me a mood, a weather, a memory — or name a record and I&rsquo;ll find its neighbors.
        </LinerNotes>
      </View>
    </View>
  );

  return (
    <BroadcastBackdrop>
      <KeyboardAvoidingView
        style={[styles.flex, { paddingTop: insets.top }]}
        behavior="padding"
        keyboardVerticalOffset={0}
      >
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            {router.canGoBack() && (
              <Pressable
                onPress={() => router.back()}
                accessibilityRole="button"
                accessibilityLabel="Go back"
                hitSlop={12}
                style={({ pressed }) => [pressed && { opacity: 0.6 }]}
              >
                <Text style={styles.backText}>← BACK</Text>
              </Pressable>
            )}
          </View>
          <Text style={styles.headerWordmark}>ASK ONAY</Text>
          <View style={styles.headerRight}>
            <SettingsCog />
          </View>
        </View>

        <FlatList
          ref={flatListRef}
          data={messages}
          renderItem={renderMessage}
          keyExtractor={item => item.id}
          style={styles.list}
          contentContainerStyle={styles.listContent}
          ListHeaderComponent={headerComponent}
          onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
        />

        {/* Typewriter input bar */}
        <View style={[styles.inputBar, { paddingBottom: Math.max(insets.bottom, Space.s10) }]}>
          <Text style={styles.inputPrefix}>ASK →</Text>
          <TextInput
            ref={inputRef}
            style={styles.input}
            value={inputText}
            onChangeText={setInputText}
            placeholder={currentPlaylist ? 'refine it…' : 'tell me a mood…'}
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
            hitSlop={10}
            style={({ pressed }) => [
              styles.pullBtn,
              (!inputText.trim() || isGenerating) && { opacity: 0.35 },
              pressed && { opacity: 0.6 },
            ]}
          >
            <Text style={styles.pullText}>PULL</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </BroadcastBackdrop>
  );
}

// ────────────────────────────── Styles ─────────────────────────────────

const styles = StyleSheet.create({
  flex: { flex: 1 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Space.s20,
    paddingTop: Space.s10,
    paddingBottom: Space.s14,
    borderBottomWidth: 0.5,
    borderBottomColor: AM.rule,
  },
  headerLeft: {
    width: 72,
    alignItems: 'flex-start',
  },
  headerRight: {
    width: 72,
    alignItems: 'flex-end',
  },
  backText: {
    color: AM.inkMid,
    fontFamily: Fonts.mono,
    fontSize: TypeScale.s10,
    letterSpacing: 2,
  },
  headerWordmark: {
    fontFamily: Fonts.display,
    fontSize: TypeScale.s16,
    color: AM.ink,
    letterSpacing: 2,
  },

  list: { flex: 1 },
  listContent: {
    paddingHorizontal: Space.s20,
    paddingTop: Space.s14,
    paddingBottom: Space.s22,
    gap: Space.s22,
  },

  greeting: {
    marginBottom: Space.s10,
  },

  requestBlock: {
    gap: Space.s8,
  },
  requestHeader: {
    fontFamily: Fonts.mono,
    fontSize: TypeScale.s9,
    color: AM.inkDim,
    letterSpacing: 2.5,
  },
  requestText: {
    fontFamily: Fonts.serif,
    fontStyle: 'italic',
    fontSize: TypeScale.s20,
    color: AM.ink,
    lineHeight: TypeScale.s20 * 1.35,
  },

  onayWrap: {
    paddingVertical: Space.s14,
    borderTopWidth: 0.5,
    borderBottomWidth: 0.5,
    borderColor: AM.rule,
    gap: Space.s8,
  },
  onayLabel: {
    fontFamily: Fonts.mono,
    fontSize: TypeScale.s9,
    color: AM.oxblood,
    letterSpacing: 2.5,
  },
  onayText: {
    fontFamily: Fonts.serif,
    fontStyle: 'italic',
    fontSize: TypeScale.s15,
    color: AM.inkMid,
    lineHeight: TypeScale.s15 * 1.55,
  },

  stance: {
    marginBottom: Space.s18,
    gap: Space.s8,
  },
  stanceHeader: {
    fontFamily: Fonts.mono,
    fontSize: TypeScale.s9,
    color: AM.oxblood,
    letterSpacing: 2.5,
  },
  stanceText: {
    fontFamily: Fonts.serif,
    fontStyle: 'italic',
    fontSize: TypeScale.s15,
    color: AM.inkMid,
    lineHeight: TypeScale.s15 * 1.55,
  },

  plate: {
    position: 'relative',
    borderWidth: 1,
    borderColor: AM.ruleStrong,
    padding: 14,
    backgroundColor: AM.bgDeep,
  },
  plateHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: Space.s10,
    borderBottomWidth: 1,
    borderBottomColor: AM.rule,
    paddingBottom: 10,
    marginBottom: 10,
  },
  plateKicker: {
    fontFamily: Fonts.mono,
    fontSize: TypeScale.s9,
    color: AM.oxblood,
    letterSpacing: 2.5,
  },
  plateTitle: {
    marginTop: 4,
    fontFamily: Fonts.display,
    fontSize: TypeScale.s22,
    color: AM.ink,
    letterSpacing: 0.3,
    lineHeight: TypeScale.s22,
  },
  plateMetaMono: {
    fontFamily: Fonts.mono,
    fontSize: TypeScale.s9,
    color: AM.inkDim,
    letterSpacing: 2,
  },
  sleeveRow: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 12,
  },
  sleeveMore: {
    width: 46, height: 46,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 0.5,
    borderStyle: 'dashed',
    borderColor: AM.inkDim,
  },
  sleeveMoreText: {
    fontFamily: Fonts.mono,
    fontSize: TypeScale.s10,
    color: AM.inkDim,
  },
  trackRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    paddingVertical: 7,
    gap: 10,
  },
  trackRowDot: {
    borderBottomWidth: 0.5,
    borderBottomColor: AM.rule,
  },
  trackNum: {
    width: 28,
    fontFamily: Fonts.mono,
    fontSize: TypeScale.s9,
    color: AM.amberDim,
    letterSpacing: 1,
  },
  trackMid: {
    flex: 1,
    minWidth: 0,
  },
  trackTitle: {
    fontFamily: Fonts.display,
    fontSize: TypeScale.s14,
    color: AM.ink,
    letterSpacing: 0.3,
    lineHeight: TypeScale.s14 * 1.1,
  },
  trackArtist: {
    marginTop: 2,
    fontFamily: Fonts.serif,
    fontStyle: 'italic',
    fontSize: TypeScale.s11,
    color: AM.inkMid,
  },
  trackYear: {
    fontFamily: Fonts.mono,
    fontSize: 8,
    color: AM.inkDim,
    letterSpacing: 1.5,
    textAlign: 'right',
  },

  secondaryGrid: {
    marginTop: Space.s10,
    flexDirection: 'row',
    gap: Space.s10,
  },
  secondary: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderWidth: 0.5,
    borderColor: AM.rule,
    alignItems: 'center',
  },
  secondaryText: {
    fontFamily: Fonts.mono,
    fontSize: TypeScale.s9,
    letterSpacing: 2,
    color: AM.inkMid,
  },

  curatorBtn: {
    marginTop: Space.s10,
    paddingVertical: 12,
    borderWidth: 0.5,
    borderColor: AM.oxbloodDim,
    alignItems: 'center',
  },
  curatorText: {
    fontFamily: Fonts.mono,
    fontSize: TypeScale.s9,
    letterSpacing: 2,
    color: AM.oxblood,
  },
  curatorOnly: {
    marginTop: 4,
    fontFamily: Fonts.mono,
    fontSize: 8,
    letterSpacing: 2,
    color: AM.inkDim,
  },

  steerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 0.5,
    borderBottomColor: AM.rule,
  },
  steerText: {
    fontFamily: Fonts.serif,
    fontStyle: 'italic',
    fontSize: TypeScale.s14,
    color: AM.amber,
    letterSpacing: 0.2,
    flex: 1,
  },
  steerArrow: {
    fontFamily: Fonts.display,
    fontSize: TypeScale.s16,
    color: AM.amber,
  },

  // Thinking indicator
  thinkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
  },
  thinkLabel: {
    fontFamily: Fonts.mono,
    fontSize: TypeScale.s10,
    color: AM.amberDim,
    letterSpacing: 2.5,
  },

  // Error
  errorBlock: {
    paddingVertical: Space.s14,
    borderTopWidth: 0.5,
    borderBottomWidth: 0.5,
    borderColor: AM.rule,
    gap: Space.s8,
  },
  errorHeader: {
    fontFamily: Fonts.mono,
    fontSize: TypeScale.s9,
    color: AM.oxblood,
    letterSpacing: 2.5,
  },
  errorText: {
    fontFamily: Fonts.serif,
    fontStyle: 'italic',
    fontSize: TypeScale.s16,
    color: AM.ink,
  },
  retryBtn: { alignSelf: 'flex-start' },
  retryText: {
    fontFamily: Fonts.mono,
    fontSize: TypeScale.s10,
    letterSpacing: 2,
    color: AM.amber,
  },

  // Input bar — typewriter paper, not chat
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: Space.s20,
    paddingTop: Space.s12,
    gap: Space.s10,
    borderTopWidth: 0.5,
    borderTopColor: AM.rule,
    backgroundColor: AM.bg,
  },
  inputPrefix: {
    fontFamily: Fonts.mono,
    fontSize: TypeScale.s10,
    color: AM.oxblood,
    letterSpacing: 2,
    paddingBottom: Space.s12,
  },
  input: {
    flex: 1,
    fontFamily: Fonts.serif,
    fontStyle: 'italic',
    fontSize: TypeScale.s15,
    color: AM.ink,
    paddingVertical: Space.s10,
    paddingHorizontal: 0,
    borderBottomWidth: 1,
    borderBottomColor: AM.amberDim,
    minHeight: 40,
    maxHeight: 120,
  },
  pullBtn: {
    paddingBottom: Space.s12,
  },
  pullText: {
    fontFamily: Fonts.mono,
    fontSize: TypeScale.s10,
    letterSpacing: 2,
    color: AM.amber,
  },
});

export default AskOnayScreen;
