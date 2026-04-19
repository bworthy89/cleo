import { useState, useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Redirect } from 'expo-router';
import { Colors, Surface } from '../src/tokens/design-tokens';
import { getUser, setUser } from '../src/services/Storage';
import { onAuthStateChanged, type AuthUser } from '../src/services/AuthService';
import { UITEST_MODE } from '../src/config/featureFlags';
import { UITEST_USER_DATA } from '../src/config/uitestFixtures';

export default function Index() {
  const [authUser, setAuthUser] = useState<AuthUser | undefined>(undefined);

  useEffect(() => {
    if (UITEST_MODE) {
      // Seed a local UserData so the "needs onboarding" branch is skipped,
      // then hop straight to the main app. Firebase auth is short-circuited
      // below via a synthetic AuthUser.
      if (!getUser()) setUser(UITEST_USER_DATA);
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

  // Logged in with profile
  return <Redirect href="/(main)" />;
}
