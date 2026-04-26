import { useState, useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Redirect } from 'expo-router';
import { Colors, Surface } from '../src/tokens/design-tokens';
import { getUser, setUser, clearUserData, hasAnyBroadcastHistory } from '../src/services/Storage';
import { onAuthStateChanged, type AuthUser } from '../src/services/AuthService';
import { UITEST_MODE } from '../src/config/featureFlags';
import { UITEST_USER_DATA } from '../src/config/uitestFixtures';

export default function Index() {
  const [authUser, setAuthUser] = useState<AuthUser | undefined>(undefined);

  useEffect(() => {
    if (UITEST_MODE) {
      // Reset all persisted user state (broadcast history, resume cursor,
      // playlist cache, ONAY suggestion) so every screenshot run starts
      // from the same fixture state, then seed the UserData and synthetic
      // AuthUser so onboarding is skipped and Firebase auth is bypassed.
      clearUserData('uitest-user-0001');
      setUser(UITEST_USER_DATA);
      setAuthUser({ uid: 'uitest-user-0001' } as unknown as AuthUser);
      return;
    }
    return onAuthStateChanged((user) => {
      setAuthUser(user);
    });
  }, []);

  // Still loading auth state
  if (authUser === undefined) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: Surface.base }}>
        <ActivityIndicator color={Colors.accent} />
      </View>
    );
  }

  // Not logged in
  if (authUser === null) {
    return <Redirect href="/(auth)/login" />;
  }

  // Logged in but no local profile (first login)
  const user = getUser();
  if (!user) {
    return <Redirect href="/(onboarding)/welcome" />;
  }

  // Logged in with profile. First-time users (no broadcast history yet)
  // route through first-listen onboarding so ONAY introduces herself with
  // a personalized bake. Returning users skip directly to /(main).
  // UITEST_MODE bypasses to keep snapshot tests deterministic.
  if (!UITEST_MODE && !hasAnyBroadcastHistory()) {
    return <Redirect href="/(onboarding)/first-listen" />;
  }
  return <Redirect href="/(main)" />;
}
