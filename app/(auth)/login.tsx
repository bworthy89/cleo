import { useState } from 'react';
import { Alert, Pressable, SafeAreaView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Typography, Spacing } from '../../src/tokens/design-tokens';
import {
  signInWithEmail,
  signUpWithEmail,
  signInWithGoogle,
  signInWithApple,
  sendPasswordReset,
} from '../../src/services/AuthService';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleEmailAuth = async () => {
    if (!email.trim() || !password.trim()) return;
    setLoading(true);
    try {
      if (isSignUp) {
        await signUpWithEmail(email.trim(), password);
      } else {
        await signInWithEmail(email.trim(), password);
      }
      router.replace('/');
    } catch (error: any) {
      Alert.alert('Error', error.message ?? 'Authentication failed');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setLoading(true);
    try {
      await signInWithGoogle();
      router.replace('/');
    } catch (error: any) {
      Alert.alert('Error', error.message ?? 'Google sign-in failed');
    } finally {
      setLoading(false);
    }
  };

  const handleAppleSignIn = async () => {
    setLoading(true);
    try {
      await signInWithApple();
      router.replace('/');
    } catch (error: any) {
      Alert.alert('Error', error.message ?? 'Apple sign-in failed');
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    if (!email.trim()) {
      Alert.alert('Enter Email', 'Enter your email address first, then tap Forgot Password.');
      return;
    }
    try {
      await sendPasswordReset(email.trim());
      Alert.alert('Check Email', 'Password reset link sent to your email.');
    } catch (error: any) {
      Alert.alert('Error', error.message ?? 'Failed to send reset email');
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.title}>CLEO</Text>
        <Text style={styles.subtitle}>AI RADIO HOST</Text>

        <View style={styles.providers}>
          <Pressable
            style={({ pressed }) => [styles.providerButton, styles.appleButton, pressed && styles.pressed]}
            onPress={handleAppleSignIn}
            disabled={loading}
          >
            <Ionicons name="logo-apple" size={20} color={Colors.base.white} />
            <Text style={[styles.providerText, { color: Colors.base.white }]}>Sign in with Apple</Text>
          </Pressable>

          <Pressable
            style={({ pressed }) => [styles.providerButton, styles.googleButton, pressed && styles.pressed]}
            onPress={handleGoogleSignIn}
            disabled={loading}
          >
            <Ionicons name="logo-google" size={18} color={Colors.base.black} />
            <Text style={[styles.providerText, { color: Colors.base.black }]}>Sign in with Google</Text>
          </Pressable>
        </View>

        <View style={styles.divider}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>OR</Text>
          <View style={styles.dividerLine} />
        </View>

        <TextInput
          style={styles.input}
          placeholder="Email"
          placeholderTextColor="rgba(0,0,0,0.3)"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          autoCorrect={false}
        />
        <TextInput
          style={styles.input}
          placeholder="Password"
          placeholderTextColor="rgba(0,0,0,0.3)"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
        />

        <Pressable
          style={({ pressed }) => [styles.emailButton, pressed && styles.pressed]}
          onPress={handleEmailAuth}
          disabled={loading}
        >
          <Text style={styles.emailButtonText}>
            {loading ? 'PLEASE WAIT...' : isSignUp ? 'CREATE ACCOUNT' : 'SIGN IN'}
          </Text>
        </Pressable>

        <View style={styles.footer}>
          <Pressable onPress={() => setIsSignUp(!isSignUp)}>
            <Text style={styles.footerLink}>
              {isSignUp ? 'Already have an account? Sign in' : "Don't have an account? Sign up"}
            </Text>
          </Pressable>

          {!isSignUp && (
            <Pressable onPress={handleForgotPassword} style={{ marginTop: Spacing.sm }}>
              <Text style={styles.footerLink}>Forgot password?</Text>
            </Pressable>
          )}
        </View>
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
    justifyContent: 'center',
  },
  title: {
    fontFamily: Typography.display.family,
    fontSize: 48,
    color: Colors.vibe.morning.text,
    textAlign: 'center',
  },
  subtitle: {
    fontFamily: Typography.mono.family,
    fontSize: 10,
    letterSpacing: 4,
    color: Colors.vibe.morning.accent,
    textAlign: 'center',
    marginBottom: Spacing.xxl,
  },
  providers: {
    gap: Spacing.md,
  },
  providerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.md,
    gap: Spacing.sm,
  },
  appleButton: {
    backgroundColor: Colors.base.black,
  },
  googleButton: {
    backgroundColor: Colors.base.white,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.15)',
  },
  providerText: {
    fontFamily: Typography.label.familyMedium,
    fontSize: 16,
  },
  pressed: {
    opacity: 0.7,
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: Spacing.xl,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: 'rgba(0,0,0,0.1)',
  },
  dividerText: {
    fontFamily: Typography.mono.family,
    fontSize: 10,
    letterSpacing: 2,
    color: 'rgba(0,0,0,0.3)',
    marginHorizontal: Spacing.md,
  },
  input: {
    fontFamily: Typography.label.family,
    fontSize: 18,
    color: Colors.vibe.morning.text,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.15)',
    paddingVertical: Spacing.md,
    marginBottom: Spacing.md,
  },
  emailButton: {
    backgroundColor: Colors.base.black,
    paddingVertical: Spacing.md,
    alignItems: 'center',
    marginTop: Spacing.sm,
  },
  emailButtonText: {
    fontFamily: Typography.mono.family,
    fontSize: 12,
    color: Colors.base.white,
    letterSpacing: 3,
  },
  footer: {
    alignItems: 'center',
    marginTop: Spacing.xl,
  },
  footerLink: {
    fontFamily: Typography.label.family,
    fontSize: 14,
    color: Colors.vibe.morning.accent,
  },
});
