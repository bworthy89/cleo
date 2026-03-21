import { useRef, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInput as TextInputType,
} from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Typography, Spacing, TextColors, Surface } from '../../src/tokens/design-tokens';
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
  const passwordRef = useRef<TextInputType>(null);

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
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          bounces={false}
        >
          {/* Branding */}
          <View style={styles.brandingSection}>
            <Text style={styles.logo}>ONAY</Text>
            <View style={styles.accentLine} />
          </View>

          {/* Headline */}
          <View style={styles.headlineSection}>
            <Text style={styles.headline}>
              Enter the{'\n'}
              <Text style={styles.headlineAccent}>Frequency.</Text>
            </Text>
            <Text style={styles.headlineLabel}>SECURE ACCESS REQUIRED</Text>
          </View>

          {/* Email/Password Form */}
          <View style={styles.formSection}>
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>LISTENER IDENTITY</Text>
              <TextInput
                style={styles.input}
                placeholder="email@address.com"
                placeholderTextColor={TextColors.outlineVariant}
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                keyboardType="email-address"
                autoCorrect={false}
                textContentType={isSignUp ? 'username' : 'emailAddress'}
                returnKeyType="next"
                onSubmitEditing={() => passwordRef.current?.focus()}
                blurOnSubmit={false}
                accessibilityLabel="Email address"
                editable={!loading}
              />
            </View>

            <View style={styles.inputGroup}>
              <View style={styles.inputLabelRow}>
                <Text style={styles.inputLabel}>ACCESS KEY</Text>
                {!isSignUp && (
                  <Pressable onPress={handleForgotPassword} hitSlop={8}>
                    <Text style={styles.forgotText}>FORGOTTEN?</Text>
                  </Pressable>
                )}
              </View>
              <TextInput
                ref={passwordRef}
                style={styles.input}
                placeholder="••••••••"
                placeholderTextColor={TextColors.outlineVariant}
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                textContentType={isSignUp ? 'newPassword' : 'password'}
                returnKeyType="go"
                onSubmitEditing={handleEmailAuth}
                accessibilityLabel="Password"
                editable={!loading}
              />
            </View>

            <Pressable
              style={({ pressed }) => [styles.ctaButton, pressed && styles.pressed, loading && styles.disabled]}
              onPress={handleEmailAuth}
              disabled={loading}
              accessibilityLabel={isSignUp ? 'Create account' : 'Sign in'}
              accessibilityRole="button"
            >
              <Text style={styles.ctaText}>
                {loading
                  ? 'PLEASE WAIT...'
                  : isSignUp
                    ? 'CREATE ACCOUNT'
                    : 'ENTER THE FREQUENCY'}
              </Text>
            </Pressable>
          </View>

          {/* Social Auth */}
          <View style={styles.syncSection}>
            <View style={styles.divider}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>SYNC VIA</Text>
              <View style={styles.dividerLine} />
            </View>

            <View style={styles.providers}>
              <Pressable
                style={({ pressed }) => [styles.providerButton, pressed && styles.pressed, loading && styles.disabled]}
                onPress={handleAppleSignIn}
                disabled={loading}
                accessibilityLabel="Sign in with Apple"
                accessibilityRole="button"
              >
                <Ionicons name="logo-apple" size={18} color={TextColors.primary} />
                <Text style={styles.providerText}>Apple</Text>
              </Pressable>

              <Pressable
                style={({ pressed }) => [styles.providerButton, pressed && styles.pressed, loading && styles.disabled]}
                onPress={handleGoogleSignIn}
                disabled={loading}
                accessibilityLabel="Sign in with Google"
                accessibilityRole="button"
              >
                <Ionicons name="logo-google" size={16} color={TextColors.primary} />
                <Text style={styles.providerText}>Google</Text>
              </Pressable>
            </View>
          </View>

          {/* Footer */}
          <View style={styles.footer}>
            <Pressable onPress={() => setIsSignUp(!isSignUp)} hitSlop={8}>
              <Text style={styles.footerText}>
                {isSignUp ? (
                  <>
                    ALREADY TUNED IN?{'  '}
                    <Text style={styles.footerLink}>SIGN IN</Text>
                  </>
                ) : (
                  <>
                    NEW TO ONAY?{'  '}
                    <Text style={styles.footerLink}>CREATE ACCOUNT</Text>
                  </>
                )}
              </Text>
            </Pressable>

            <View style={styles.legalRow}>
              <Text style={styles.legalText}>PRIVACY</Text>
              <Text style={styles.legalDot}>·</Text>
              <Text style={styles.legalText}>TERMS</Text>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Surface.base,
  },
  flex: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: Spacing.lg,
    justifyContent: 'center',
    paddingVertical: Spacing.xxl,
  },

  // Branding
  brandingSection: {
    alignItems: 'flex-start',
    marginBottom: Spacing.xl,
  },
  logo: {
    fontFamily: Typography.display.family,
    fontSize: 42,
    color: TextColors.primary,
    letterSpacing: 6,
  },
  accentLine: {
    width: 40,
    height: 2,
    backgroundColor: Colors.accent,
    marginTop: Spacing.sm,
  },

  // Headline
  headlineSection: {
    marginBottom: Spacing.xl,
  },
  headline: {
    fontFamily: Typography.display.family,
    fontSize: 36,
    color: TextColors.primary,
    lineHeight: 44,
  },
  headlineAccent: {
    color: Colors.accent,
  },
  headlineLabel: {
    fontFamily: Typography.mono.family,
    fontSize: 10,
    letterSpacing: 3,
    color: TextColors.outline,
    marginTop: Spacing.md,
  },

  // Form
  formSection: {
    marginBottom: Spacing.lg,
  },
  inputGroup: {
    marginBottom: Spacing.lg,
  },
  inputLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  inputLabel: {
    fontFamily: Typography.mono.family,
    fontSize: 10,
    letterSpacing: 2,
    color: Colors.accent,
    marginBottom: Spacing.sm,
  },
  forgotText: {
    fontFamily: Typography.mono.family,
    fontSize: 10,
    letterSpacing: 1.5,
    color: Colors.accent,
    marginBottom: Spacing.sm,
  },
  input: {
    fontFamily: Typography.body.family,
    fontSize: 16,
    color: TextColors.primary,
    borderBottomWidth: 1,
    borderBottomColor: TextColors.outlineVariant,
    paddingVertical: Spacing.sm + 2,
    paddingHorizontal: 0,
  },
  ctaButton: {
    borderWidth: 1,
    borderColor: Colors.accent,
    paddingVertical: Spacing.md,
    alignItems: 'center',
    marginTop: Spacing.sm,
  },
  ctaText: {
    fontFamily: Typography.mono.family,
    fontSize: 12,
    color: Colors.accent,
    letterSpacing: 3,
  },
  pressed: {
    opacity: 0.7,
  },
  disabled: {
    opacity: 0.4,
  },

  // Social Auth
  syncSection: {
    marginBottom: Spacing.lg,
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: Spacing.md,
  },
  dividerLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: TextColors.outlineVariant,
  },
  dividerText: {
    fontFamily: Typography.mono.family,
    fontSize: 10,
    letterSpacing: 2,
    color: TextColors.outline,
    marginHorizontal: Spacing.md,
  },
  providers: {
    flexDirection: 'row',
    gap: Spacing.md,
  },
  providerButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.sm + 4,
    gap: Spacing.sm,
    borderWidth: 1,
    borderColor: TextColors.outlineVariant,
  },
  providerText: {
    fontFamily: Typography.body.familyMedium,
    fontSize: 14,
    color: TextColors.primary,
  },

  // Footer
  footer: {
    alignItems: 'center',
    gap: Spacing.md,
  },
  footerText: {
    fontFamily: Typography.mono.family,
    fontSize: 10,
    letterSpacing: 1.5,
    color: TextColors.outline,
  },
  footerLink: {
    color: Colors.accent,
  },
  legalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  legalText: {
    fontFamily: Typography.mono.family,
    fontSize: 9,
    letterSpacing: 1.5,
    color: TextColors.outlineVariant,
  },
  legalDot: {
    fontFamily: Typography.mono.family,
    fontSize: 9,
    color: TextColors.outlineVariant,
  },
});
