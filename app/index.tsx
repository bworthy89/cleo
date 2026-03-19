import { useState, useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Redirect } from 'expo-router';
import { Colors } from '../src/tokens/design-tokens';
import { getUser } from '../src/services/Storage';
import { onAuthStateChanged, type AuthUser } from '../src/services/AuthService';

export default function Index() {
  const [authUser, setAuthUser] = useState<AuthUser | undefined>(undefined);

  useEffect(() => {
    return onAuthStateChanged((user) => {
      setAuthUser(user);
    });
  }, []);

  // Still loading auth state
  if (authUser === undefined) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.vibe.morning.bg }}>
        <ActivityIndicator color={Colors.vibe.morning.accent} />
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
