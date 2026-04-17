import { useCallback, useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import auth from '@react-native-firebase/auth';
import { AM, Fonts, Space, TypeScale } from '../../tokens/design-tokens';
import { BroadcastBackdrop } from '../../components/BroadcastBackdrop';
import { AppHeader } from '../../components/AppHeader';
import { HairlineRow } from '../../components/HairlineRow';
import { musicKitPlayer } from '../../services/MusicKitPlayer';
import { signOut } from '../../services/AuthService';
import { authorize } from '../../../modules/expo-music-kit';

const HEADER_HEIGHT = 44;

export function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const firebaseUser = auth().currentUser;
  const displayName = firebaseUser?.displayName ?? 'Listener';
  const email = firebaseUser?.email ?? '';

  const [appleMusicConnected, setAppleMusicConnected] = useState(false);

  useEffect(() => {
    musicKitPlayer.isAuthorized().then(setAppleMusicConnected).catch(() => {});
  }, []);

  const handleAppleMusicConnect = useCallback(async () => {
    if (appleMusicConnected) return;
    try {
      const result = await authorize();
      if (result.status === 'authorized') setAppleMusicConnected(true);
    } catch (err) {
      console.warn('[ProfileScreen] Apple Music auth failed:', err);
    }
  }, [appleMusicConnected]);

  const handleSignOut = useCallback(() => {
    Alert.alert(
      'Sign Out',
      'Are you sure you want to sign out?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign Out',
          style: 'destructive',
          onPress: async () => {
            try {
              await musicKitPlayer.pause();
              await signOut();
              router.replace('/(auth)/login');
            } catch {
              // sign-out failed — stay on screen
            }
          },
        },
      ],
    );
  }, []);

  return (
    <BroadcastBackdrop>
      <AppHeader />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: insets.top + HEADER_HEIGHT + Space.s34,
            paddingBottom: insets.bottom + 80,
          },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* your account */}
        <Text style={styles.sectionLabel}>your account</Text>
        <View style={{ height: Space.s10 }} />
        <HairlineRow
          topRule
          verticalPadding={Space.s16}
          leading={<Text style={styles.rowLabel}>NAME</Text>}
          leadingWidth={72}
          value={
            <Text style={styles.rowValue} numberOfLines={1}>{displayName}</Text>
          }
        />
        {email ? (
          <HairlineRow
            verticalPadding={Space.s16}
            leading={<Text style={styles.rowLabel}>EMAIL</Text>}
            leadingWidth={72}
            value={
              <Text style={styles.rowValue} numberOfLines={1}>{email}</Text>
            }
          />
        ) : null}

        {/* connections */}
        <View style={{ height: Space.s34 }} />
        <Text style={styles.sectionLabel}>connections</Text>
        <View style={{ height: Space.s10 }} />
        <HairlineRow
          topRule
          verticalPadding={Space.s16}
          leading={<Text style={styles.rowLabel}>APPLE MUSIC</Text>}
          leadingWidth={110}
          value={
            <Text
              style={[
                styles.rowValue,
                { color: appleMusicConnected ? AM.ink : AM.inkMid },
              ]}
            >
              {appleMusicConnected ? 'connected' : 'not connected'}
            </Text>
          }
          trailing={
            appleMusicConnected ? null : (
              <Text style={styles.chev}>{'\u203A'}</Text>
            )
          }
          onPress={appleMusicConnected ? undefined : handleAppleMusicConnect}
          accessibilityLabel={
            appleMusicConnected ? 'Apple Music connected' : 'Connect Apple Music'
          }
        />

        {/* account */}
        <View style={{ height: Space.s34 }} />
        <Text style={styles.sectionLabel}>account</Text>
        <View style={{ height: Space.s10 }} />
        <HairlineRow
          topRule
          verticalPadding={Space.s16}
          value={<Text style={styles.signOutText}>sign out</Text>}
          trailing={<Text style={styles.chev}>{'\u203A'}</Text>}
          onPress={handleSignOut}
          accessibilityLabel="Sign out"
        />
      </ScrollView>
    </BroadcastBackdrop>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: {
    paddingHorizontal: Space.s26,
  },
  sectionLabel: {
    fontFamily: Fonts.mono,
    fontSize: TypeScale.s10,
    letterSpacing: 2.5,
    color: AM.inkDim,
  },
  rowLabel: {
    fontFamily: Fonts.mono,
    fontSize: TypeScale.s10,
    letterSpacing: 2,
    color: AM.inkDim,
  },
  rowValue: {
    fontFamily: Fonts.display,
    fontSize: TypeScale.s16,
    fontStyle: 'italic',
    color: AM.ink,
  },
  signOutText: {
    fontFamily: Fonts.display,
    fontSize: TypeScale.s18,
    fontStyle: 'italic',
    color: AM.amber,
  },
  chev: {
    fontFamily: Fonts.display,
    fontSize: TypeScale.s16,
    color: AM.inkDim,
  },
});
