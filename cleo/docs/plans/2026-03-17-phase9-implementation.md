# Phase 9 — Onboarding + Full Navigation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Complete app flow with Expo Router navigation: first-launch onboarding (4 screens), home → player navigation, and settings screens.

**Architecture:** Expo Router file-based routing replaces state-based navigation. Route groups: (onboarding), (main), (settings). Current screens migrated to route files. Components, engines, and services stay in `src/`. Onboarding completion stored in MMKV.

**Tech Stack:** Expo Router, expo-font, MMKV, existing component library

**Important build notes:**
- Project lives at `/Users/kari/Documents/DJ App/cleo` but native builds must use `/Users/kari/Documents/cleo-app/` (no spaces in path)
- Ruby 3.2.4 via rbenv for CocoaPods
- iOS deployment target: 16.0
- Apple Developer Team: 8F2VWCN5KF
- After `expo prebuild --clean`, must: set `ios.deploymentTarget` in Podfile.properties.json, clear entitlements, fix IPHONEOS_DEPLOYMENT_TARGET in project.pbxproj

---

### Task 1: Install Expo Router and restructure project

**Files:**
- Modify: `package.json`
- Modify: `app.json`
- Modify: `tsconfig.json`
- Create: `app/_layout.tsx`
- Create: `app/index.tsx`
- Delete: `App.tsx` (replaced by app/_layout.tsx)

**Step 1: Install Expo Router**

```bash
cd "/Users/kari/Documents/DJ App/cleo"
npx expo install expo-router expo-linking expo-constants
```

**Step 2: Update app.json**

Add scheme and update main entry:

```json
{
  "expo": {
    "name": "Cleo",
    "slug": "cleo",
    "version": "1.0.0",
    "orientation": "portrait",
    "icon": "./assets/icon.png",
    "userInterfaceStyle": "light",
    "scheme": "cleo",
    "splash": {
      "image": "./assets/splash-icon.png",
      "resizeMode": "contain",
      "backgroundColor": "#FAF6EF"
    },
    "ios": {
      "supportsTablet": false,
      "bundleIdentifier": "com.worthymedia.cleo",
      "infoPlist": {
        "NSAppleMusicUsageDescription": "Cleo uses Apple Music to play your playlists with AI-powered radio hosting."
      },
      "entitlements": {
        "com.apple.developer.musickit": ["music-items"]
      },
      "deploymentTarget": "16.0"
    },
    "android": {
      "adaptiveIcon": {
        "backgroundColor": "#FAF6EF",
        "foregroundImage": "./assets/android-icon-foreground.png",
        "backgroundImage": "./assets/android-icon-background.png",
        "monochromeImage": "./assets/android-icon-monochrome.png"
      },
      "package": "com.worthymedia.cleo"
    },
    "web": {
      "favicon": "./assets/favicon.png",
      "bundler": "metro"
    },
    "plugins": [
      "expo-font",
      "react-native-video",
      "expo-router"
    ]
  }
}
```

**Step 3: Update package.json main entry**

Add `"main": "expo-router/entry"` to package.json (replace existing `"main": "index.ts"`).

**Step 4: Create root layout**

`app/_layout.tsx`:
```typescript
import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    PlayfairDisplay_400Regular: require('@expo-google-fonts/playfair-display/400Regular/PlayfairDisplay_400Regular.ttf'),
    WorkSans_400Regular: require('@expo-google-fonts/work-sans/400Regular/WorkSans_400Regular.ttf'),
    WorkSans_500Medium: require('@expo-google-fonts/work-sans/500Medium/WorkSans_500Medium.ttf'),
    EBGaramond_400Regular: require('@expo-google-fonts/eb-garamond/400Regular/EBGaramond_400Regular.ttf'),
    EBGaramond_400Regular_Italic: require('@expo-google-fonts/eb-garamond/400Regular_Italic/EBGaramond_400Regular_Italic.ttf'),
    DMMono_400Regular: require('@expo-google-fonts/dm-mono/400Regular/DMMono_400Regular.ttf'),
  });

  useEffect(() => {
    if (fontsLoaded) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded]);

  if (!fontsLoaded) return null;

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="(onboarding)" />
      <Stack.Screen name="(main)" />
      <Stack.Screen name="(settings)" />
    </Stack>
  );
}
```

**Step 5: Create index redirect**

`app/index.tsx`:
```typescript
import { Redirect } from 'expo-router';
import { getUser } from '../src/services/Storage';

export default function Index() {
  const user = getUser();

  if (!user) {
    return <Redirect href="/(onboarding)/welcome" />;
  }

  return <Redirect href="/(main)" />;
}
```

**Step 6: Delete old App.tsx**

```bash
rm App.tsx
```

**Step 7: Verify it builds**

```bash
npx tsc --noEmit
```

**Step 8: Commit**

```bash
git add -A
git commit -m "feat: install Expo Router and create root layout with redirect"
```

---

### Task 2: Create onboarding screens

**Files:**
- Create: `app/(onboarding)/_layout.tsx`
- Create: `app/(onboarding)/welcome.tsx`
- Create: `app/(onboarding)/music-auth.tsx`
- Create: `app/(onboarding)/vibe-setup.tsx`
- Create: `app/(onboarding)/first-station.tsx`
- Create: `src/components/VibeSelector.tsx`

**Step 1: Create onboarding layout**

`app/(onboarding)/_layout.tsx`:
```typescript
import { Stack } from 'expo-router';

export default function OnboardingLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        animation: 'slide_from_right',
      }}
    />
  );
}
```

**Step 2: Create WelcomeScreen**

`app/(onboarding)/welcome.tsx`:
```typescript
import { Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Colors, Typography, Spacing } from '../../src/tokens/design-tokens';

export default function WelcomeScreen() {
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.title}>CLEO</Text>
        <Text style={styles.tagline}>
          Every song has a story.{'\n'}I'm just here to tell it.
        </Text>
        <Text style={styles.description}>
          Your personal AI radio host. I'll play your music, share the stories behind the songs, and make every session feel like it was made just for you.
        </Text>
      </View>
      <View style={styles.bottom}>
        <Pressable style={styles.button} onPress={() => router.push('/(onboarding)/music-auth')}>
          <Text style={styles.buttonText}>GET STARTED</Text>
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
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: Spacing.xl,
  },
  title: {
    fontFamily: Typography.display.family,
    fontSize: 72,
    color: Colors.vibe.morning.text,
    letterSpacing: 8,
    marginBottom: Spacing.lg,
  },
  tagline: {
    fontFamily: Typography.cleoVoice.family,
    fontStyle: 'italic',
    fontSize: 20,
    color: Colors.accent,
    textAlign: 'center',
    lineHeight: 30,
    marginBottom: Spacing.xl,
  },
  description: {
    fontFamily: Typography.label.family,
    fontSize: 16,
    color: Colors.vibe.morning.text,
    textAlign: 'center',
    lineHeight: 24,
    opacity: 0.7,
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
  buttonText: {
    fontFamily: Typography.mono.family,
    fontSize: 14,
    color: Colors.base.white,
    letterSpacing: 3,
  },
});
```

**Step 3: Create MusicAuthScreen**

`app/(onboarding)/music-auth.tsx`:
```typescript
import { Pressable, SafeAreaView, StyleSheet, Text, View, Alert } from 'react-native';
import { router } from 'expo-router';
import { Colors, Typography, Spacing } from '../../src/tokens/design-tokens';
import { musicKitPlayer } from '../../src/services/MusicKitPlayer';

export default function MusicAuthScreen() {
  const handleConnect = async () => {
    const result = await musicKitPlayer.authorize();
    if (result.status === 'authorized') {
      router.push('/(onboarding)/vibe-setup');
    } else {
      Alert.alert(
        'Apple Music Required',
        'Cleo needs access to your Apple Music library to play your playlists. Please enable it in Settings.',
      );
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.emoji}>🎵</Text>
        <Text style={styles.title}>Connect Your Music</Text>
        <Text style={styles.description}>
          Cleo plays music from your Apple Music library. Connect your account so she can access your playlists and start hosting your sessions.
        </Text>
      </View>
      <View style={styles.bottom}>
        <Pressable style={styles.button} onPress={handleConnect}>
          <Text style={styles.buttonText}>CONNECT APPLE MUSIC</Text>
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
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: Spacing.xl,
  },
  emoji: {
    fontSize: 64,
    marginBottom: Spacing.lg,
  },
  title: {
    fontFamily: Typography.display.family,
    fontSize: 28,
    color: Colors.vibe.morning.text,
    marginBottom: Spacing.md,
    textAlign: 'center',
  },
  description: {
    fontFamily: Typography.label.family,
    fontSize: 16,
    color: Colors.vibe.morning.text,
    textAlign: 'center',
    lineHeight: 24,
    opacity: 0.7,
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
  buttonText: {
    fontFamily: Typography.mono.family,
    fontSize: 14,
    color: Colors.base.white,
    letterSpacing: 3,
  },
});
```

**Step 4: Create VibeSelector component**

`src/components/VibeSelector.tsx`:
```typescript
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Colors, Typography, Spacing } from '../tokens/design-tokens';
import type { Vibe } from '../cleo/fallbacks';

interface VibeSelectorProps {
  selected: Vibe;
  onSelect: (vibe: Vibe) => void;
}

const VIBES: { id: Vibe; label: string; emoji: string }[] = [
  { id: 'morning', label: 'Morning', emoji: '☀️' },
  { id: 'chill', label: 'Chill', emoji: '🌊' },
  { id: 'workout', label: 'Workout', emoji: '🔥' },
  { id: 'lateNight', label: 'Late Night', emoji: '🌙' },
  { id: 'party', label: 'Party', emoji: '🎉' },
];

export function VibeSelector({ selected, onSelect }: VibeSelectorProps) {
  return (
    <View style={styles.container}>
      {VIBES.map((vibe) => {
        const isSelected = selected === vibe.id;
        const theme = Colors.vibe[vibe.id];
        return (
          <Pressable
            key={vibe.id}
            style={[
              styles.card,
              { backgroundColor: theme.bg, borderColor: isSelected ? theme.accent : 'transparent' },
            ]}
            onPress={() => onSelect(vibe.id)}
          >
            <Text style={styles.emoji}>{vibe.emoji}</Text>
            <Text style={[styles.label, { color: theme.text }]}>{vibe.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: Spacing.md,
  },
  card: {
    width: 100,
    height: 100,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderRadius: 4,
  },
  emoji: {
    fontSize: 28,
    marginBottom: Spacing.xs,
  },
  label: {
    fontFamily: Typography.mono.family,
    fontSize: 10,
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
});
```

**Step 5: Create VibeSetupScreen**

`app/(onboarding)/vibe-setup.tsx`:
```typescript
import { useState } from 'react';
import { Pressable, SafeAreaView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { Colors, Typography, Spacing } from '../../src/tokens/design-tokens';
import { VibeSelector } from '../../src/components/VibeSelector';
import { setUser } from '../../src/services/Storage';
import type { Vibe } from '../../src/cleo/fallbacks';

export default function VibeSetupScreen() {
  const [name, setName] = useState('');
  const [vibe, setVibe] = useState<Vibe>('chill');

  const handleContinue = () => {
    setUser({
      name: name.trim() || undefined,
      appleMusicAuthorized: true,
      createdAt: new Date().toISOString(),
      defaultVibe: vibe,
    });
    router.push('/(onboarding)/first-station');
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.title}>Make It Yours</Text>

        <Text style={styles.label}>YOUR NAME</Text>
        <TextInput
          style={styles.input}
          placeholder="What should Cleo call you?"
          placeholderTextColor="rgba(0,0,0,0.3)"
          value={name}
          onChangeText={setName}
          autoCapitalize="words"
          autoCorrect={false}
        />

        <Text style={[styles.label, { marginTop: Spacing.xl }]}>DEFAULT VIBE</Text>
        <VibeSelector selected={vibe} onSelect={setVibe} />
      </View>
      <View style={styles.bottom}>
        <Pressable style={styles.button} onPress={handleContinue}>
          <Text style={styles.buttonText}>CONTINUE</Text>
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
  content: {
    flex: 1,
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.xxl,
  },
  title: {
    fontFamily: Typography.display.family,
    fontSize: 32,
    color: Colors.vibe.morning.text,
    marginBottom: Spacing.xl,
  },
  label: {
    fontFamily: Typography.mono.family,
    fontSize: 10,
    color: Colors.vibe.morning.text,
    letterSpacing: 3,
    marginBottom: Spacing.sm,
  },
  input: {
    fontFamily: Typography.label.family,
    fontSize: 18,
    color: Colors.vibe.morning.text,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.15)',
    paddingVertical: Spacing.md,
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
  buttonText: {
    fontFamily: Typography.mono.family,
    fontSize: 14,
    color: Colors.base.white,
    letterSpacing: 3,
  },
});
```

Note: `UserData` in Storage.ts will need a `defaultVibe` field added.

**Step 6: Create FirstStationScreen**

`app/(onboarding)/first-station.tsx`:
```typescript
import { useEffect, useState } from 'react';
import { FlatList, Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Colors, Typography, Spacing } from '../../src/tokens/design-tokens';
import { StationCard } from '../../src/components/StationCard';
import { musicKitPlayer } from '../../src/services/MusicKitPlayer';
import { addStation } from '../../src/services/Storage';
import type { MusicPlaylist } from '../../modules/expo-music-kit';

export default function FirstStationScreen() {
  const [playlists, setPlaylists] = useState<MusicPlaylist[]>([]);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const lists = await musicKitPlayer.fetchPlaylists();
      setPlaylists(lists);
    })();
  }, []);

  const handleSelect = (playlist: MusicPlaylist) => {
    setSelected(playlist.id);
    addStation({
      id: `station-${Date.now()}`,
      name: playlist.name,
      playlistId: playlist.id,
      defaultVibe: 'chill',
      artworkUrl: playlist.artworkUrl,
      createdAt: new Date().toISOString(),
    });
  };

  const handleDone = () => {
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
```

**Step 7: Update UserData in Storage.ts**

Add `defaultVibe?: string` to the `UserData` interface.

**Step 8: Commit**

```bash
git add -A
git commit -m "feat: add 4 onboarding screens with Expo Router navigation"
```

---

### Task 3: Migrate HomeScreen and PlayerScreen to Expo Router

**Files:**
- Create: `app/(main)/_layout.tsx`
- Create: `app/(main)/index.tsx`
- Create: `app/(main)/player.tsx`
- Modify: `src/screens/home/HomeScreen.tsx`
- Modify: `src/screens/player/PlayerScreen.tsx`

**Step 1: Create main layout**

`app/(main)/_layout.tsx`:
```typescript
import { Stack } from 'expo-router';

export default function MainLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen
        name="player"
        options={{ animation: 'slide_from_bottom', gestureEnabled: false }}
      />
    </Stack>
  );
}
```

**Step 2: Create main index (HomeScreen wrapper)**

`app/(main)/index.tsx`:
```typescript
import { router } from 'expo-router';
import { HomeScreen } from '../../src/screens/home/HomeScreen';
import type { Vibe } from '../../src/cleo/fallbacks';

export default function MainIndex() {
  return (
    <HomeScreen
      onNavigateToPlayer={(params) => {
        router.push({
          pathname: '/(main)/player',
          params: {
            stationName: params.stationName,
            playlistId: params.playlistId,
            stationId: params.stationId,
            vibe: params.vibe,
          },
        });
      }}
      onNavigateToSettings={() => {
        router.push('/(settings)/profile');
      }}
    />
  );
}
```

**Step 3: Create player route**

`app/(main)/player.tsx`:
```typescript
import { useLocalSearchParams } from 'expo-router';
import { router } from 'expo-router';
import { PlayerScreen } from '../../src/screens/player/PlayerScreen';
import type { Vibe } from '../../src/cleo/fallbacks';

export default function PlayerRoute() {
  const params = useLocalSearchParams<{
    stationName: string;
    playlistId: string;
    stationId: string;
    vibe: string;
  }>();

  return (
    <PlayerScreen
      stationName={params.stationName ?? 'Station'}
      playlistId={params.playlistId ?? ''}
      stationId={params.stationId ?? ''}
      vibe={(params.vibe as Vibe) ?? 'chill'}
      onBack={() => router.back()}
    />
  );
}
```

**Step 4: Update HomeScreen to accept onNavigateToSettings prop**

Add `onNavigateToSettings?: () => void` to HomeScreenProps. Add a settings icon/button in the header that calls it.

**Step 5: Commit**

```bash
git add -A
git commit -m "feat: migrate Home and Player screens to Expo Router"
```

---

### Task 4: Build settings screens

**Files:**
- Create: `app/(settings)/_layout.tsx`
- Create: `app/(settings)/profile.tsx`
- Create: `app/(settings)/host-settings.tsx`
- Create: `app/(settings)/history.tsx`

**Step 1: Create settings layout**

`app/(settings)/_layout.tsx`:
```typescript
import { Stack } from 'expo-router';
import { Colors } from '../../src/tokens/design-tokens';

export default function SettingsLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: true,
        headerStyle: { backgroundColor: Colors.vibe.morning.bg },
        headerTintColor: Colors.vibe.morning.text,
        headerTitleStyle: { fontFamily: 'WorkSans_500Medium', fontSize: 16 },
        headerBackTitle: 'Back',
      }}
    >
      <Stack.Screen name="profile" options={{ title: 'Profile' }} />
      <Stack.Screen name="host-settings" options={{ title: 'Host Settings' }} />
      <Stack.Screen name="history" options={{ title: 'Session History' }} />
    </Stack>
  );
}
```

**Step 2: Create ProfileScreen**

`app/(settings)/profile.tsx`:
```typescript
import { useState } from 'react';
import { Pressable, SafeAreaView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Colors, Typography, Spacing } from '../../src/tokens/design-tokens';
import { getUser, setUser } from '../../src/services/Storage';
import { VibeSelector } from '../../src/components/VibeSelector';
import type { Vibe } from '../../src/cleo/fallbacks';

export default function ProfileScreen() {
  const user = getUser();
  const [name, setName] = useState(user?.name ?? '');
  const [vibe, setVibe] = useState<Vibe>((user?.defaultVibe as Vibe) ?? 'chill');
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    setUser({
      ...user!,
      name: name.trim() || undefined,
      defaultVibe: vibe,
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <View style={styles.container}>
      <Text style={styles.label}>YOUR NAME</Text>
      <TextInput
        style={styles.input}
        value={name}
        onChangeText={setName}
        placeholder="Your name"
        placeholderTextColor="rgba(0,0,0,0.3)"
        autoCapitalize="words"
      />

      <Text style={[styles.label, { marginTop: Spacing.xl }]}>DEFAULT VIBE</Text>
      <VibeSelector selected={vibe} onSelect={setVibe} />

      <Text style={[styles.label, { marginTop: Spacing.xl }]}>APPLE MUSIC</Text>
      <Text style={styles.status}>✓ Connected</Text>

      <View style={styles.bottom}>
        <Pressable style={styles.button} onPress={handleSave}>
          <Text style={styles.buttonText}>{saved ? 'SAVED ✓' : 'SAVE'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.vibe.morning.bg,
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.lg,
  },
  label: {
    fontFamily: Typography.mono.family,
    fontSize: 10,
    color: Colors.vibe.morning.text,
    letterSpacing: 3,
    marginBottom: Spacing.sm,
  },
  input: {
    fontFamily: Typography.label.family,
    fontSize: 18,
    color: Colors.vibe.morning.text,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.15)',
    paddingVertical: Spacing.md,
  },
  status: {
    fontFamily: Typography.label.family,
    fontSize: 16,
    color: Colors.accent,
    marginTop: Spacing.sm,
  },
  bottom: {
    marginTop: Spacing.xxl,
  },
  button: {
    backgroundColor: Colors.base.black,
    paddingVertical: Spacing.md,
    alignItems: 'center',
  },
  buttonText: {
    fontFamily: Typography.mono.family,
    fontSize: 14,
    color: Colors.base.white,
    letterSpacing: 3,
  },
});
```

**Step 3: Create HostSettingsScreen**

`app/(settings)/host-settings.tsx`:
```typescript
import { useState } from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';
import { Colors, Typography, Spacing } from '../../src/tokens/design-tokens';

export default function HostSettingsScreen() {
  const [commentary, setCommentary] = useState(true);
  const [pullQuotes, setPullQuotes] = useState(true);

  return (
    <View style={styles.container}>
      <View style={styles.row}>
        <View style={styles.rowText}>
          <Text style={styles.rowTitle}>Cleo Commentary</Text>
          <Text style={styles.rowSubtitle}>Cleo speaks between tracks</Text>
        </View>
        <Switch value={commentary} onValueChange={setCommentary} />
      </View>

      <View style={styles.row}>
        <View style={styles.rowText}>
          <Text style={styles.rowTitle}>Pull Quotes</Text>
          <Text style={styles.rowSubtitle}>Full-screen track story moments</Text>
        </View>
        <Switch value={pullQuotes} onValueChange={setPullQuotes} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.vibe.morning.bg,
    paddingTop: Spacing.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.08)',
  },
  rowText: {
    flex: 1,
    marginRight: Spacing.md,
  },
  rowTitle: {
    fontFamily: Typography.label.familyMedium,
    fontSize: 16,
    color: Colors.vibe.morning.text,
  },
  rowSubtitle: {
    fontFamily: Typography.label.family,
    fontSize: 13,
    color: Colors.vibe.morning.text,
    opacity: 0.5,
    marginTop: Spacing.xs,
  },
});
```

**Step 4: Create HistoryScreen**

`app/(settings)/history.tsx`:
```typescript
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { Colors, Typography, Spacing } from '../../src/tokens/design-tokens';
import { storage } from '../../src/services/Storage';

interface SessionRecord {
  id: string;
  stationId: string;
  vibe: string;
  startTime: number;
  tracksPlayed: string[];
}

function getSessionHistory(): SessionRecord[] {
  const raw = storage.getString('sessionHistory');
  return raw ? JSON.parse(raw) : [];
}

export default function HistoryScreen() {
  const sessions = getSessionHistory();

  if (sessions.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>No sessions yet</Text>
        <Text style={styles.emptySubtext}>Start listening to build your history</Text>
      </View>
    );
  }

  return (
    <FlatList
      style={styles.container}
      data={sessions}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => {
        const date = new Date(item.startTime);
        const duration = item.tracksPlayed.length;
        return (
          <View style={styles.row}>
            <Text style={styles.date}>
              {date.toLocaleDateString()} · {date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </Text>
            <Text style={styles.detail}>
              {duration} tracks · {item.vibe}
            </Text>
          </View>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.vibe.morning.bg,
  },
  empty: {
    flex: 1,
    backgroundColor: Colors.vibe.morning.bg,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyText: {
    fontFamily: Typography.label.familyMedium,
    fontSize: 18,
    color: Colors.vibe.morning.text,
  },
  emptySubtext: {
    fontFamily: Typography.label.family,
    fontSize: 14,
    color: Colors.vibe.morning.text,
    opacity: 0.5,
    marginTop: Spacing.sm,
  },
  row: {
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.08)',
  },
  date: {
    fontFamily: Typography.label.familyMedium,
    fontSize: 16,
    color: Colors.vibe.morning.text,
  },
  detail: {
    fontFamily: Typography.mono.family,
    fontSize: 12,
    color: Colors.vibe.morning.text,
    opacity: 0.5,
    letterSpacing: 1,
    marginTop: Spacing.xs,
    textTransform: 'uppercase',
  },
});
```

**Step 5: Commit**

```bash
git add -A
git commit -m "feat: add settings screens — profile, host settings, history"
```

---

### Task 5: Rebuild and test on device

**Step 1: Rebuild native project**

Expo Router requires a native rebuild since it changes the entry point.

```bash
# Sync to build path
rsync -a --exclude='ios' --exclude='android' --exclude='node_modules' --exclude='.git' --exclude='server' \
  "/Users/kari/Documents/DJ App/cleo/" /Users/kari/Documents/cleo-app/

cd /Users/kari/Documents/cleo-app && npm install && rm -rf ios android && npx expo prebuild --clean

# Pod install + deployment target fix
echo '{"expo.jsEngine":"hermes","EX_DEV_CLIENT_NETWORK_INSPECTOR":"true","ios.deploymentTarget":"16.0"}' > ios/Podfile.properties.json
cat > ios/Cleo/Cleo.entitlements << 'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict/>
</plist>
PLIST
export PATH="$HOME/.rbenv/bin:$HOME/.rbenv/shims:$PATH" && eval "$(rbenv init - zsh)"
cd ios && pod install
sed -i '' 's/IPHONEOS_DEPLOYMENT_TARGET = 15.1/IPHONEOS_DEPLOYMENT_TARGET = 16.0/g' Cleo.xcodeproj/project.pbxproj

# Build
cd .. && rm -rf ~/Library/Developer/Xcode/DerivedData/Cleo-*
xcodebuild -workspace ios/Cleo.xcworkspace -configuration Debug -scheme Cleo \
  -destination "id=00008120-000C7CAE1407601E" DEVELOPMENT_TEAM=8F2VWCN5KF \
  -allowProvisioningUpdates -allowProvisioningDeviceRegistration
```

**Step 2: Start servers and test**

```bash
# Backend
cd "/Users/kari/Documents/DJ App/cleo/server" && npx tsx src/index.ts &

# Metro (from build path)
cd /Users/kari/Documents/cleo-app && npx expo start --port 8081 &

# Install and launch
xcrun devicectl device install app --device "00008120-000C7CAE1407601E" <Cleo.app path>
xcrun devicectl device process launch --device "00008120-000C7CAE1407601E" com.worthymedia.cleo
```

**Step 3: Test complete flow**

1. Clear app data (delete and reinstall) to trigger onboarding
2. Welcome screen → Get Started
3. Music Auth → Connect Apple Music → permission prompt
4. Vibe Setup → enter name, pick vibe → Continue
5. First Station → pick a playlist → Start Listening
6. Home screen with stations
7. Tap station → Player screen
8. Back button → Home
9. Settings → Profile, Host Settings, History

**Step 4: Commit**

```bash
git add -A
git commit -m "feat: Phase 9 complete — full onboarding + Expo Router navigation"
git push origin main
```

---

## Milestone Verification

Phase 9 is complete when:

- [ ] First launch shows onboarding flow (4 screens)
- [ ] Apple Music permission requested in onboarding
- [ ] Name and vibe saved to MMKV
- [ ] First station created from playlist selection
- [ ] Subsequent launches skip onboarding, go to Home
- [ ] Home → Player navigation works (slide up)
- [ ] Player → Home back navigation works
- [ ] Settings screens accessible (Profile, Host Settings, History)
- [ ] Session history shows past sessions
- [ ] All screens use correct fonts and vibe theme colors
