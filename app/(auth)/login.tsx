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
import { AM, Fonts, Space, TypeScale, ZIndex } from '../../src/tokens/design-tokens';
import { SleeveArt, SpinningRecord, Tick } from '../../src/components/crate';
import {
  signInWithEmail,
  signUpWithEmail,
  signInWithGoogle,
  signInWithApple,
  sendPasswordReset,
} from '../../src/services/AuthService';

/**
 * Login — "THE DOOR" variant from the crate-digger design.
 *
 * Full-bleed editorial sleeve trio behind a tall "ONAY" masthead with
 * "MEMBER ENTRANCE · EST. 2026" kicker. Apple-filled / Google-outline
 * socials are the primary path; email/password is secondary (toggled on).
 * "Not a member? Become a member →" routes to the onboarding tour.
 */
export default function LoginScreen() {
  const [mode, setMode] = useState<'social' | 'email'>('social');
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
          {/* Sleeve trio — skewed behind the masthead */}
          <View style={styles.sleeveTrio} pointerEvents="none">
            <View style={styles.sleeveBackLeft}>
              <SleeveArt title="After Hours" artist="Ben Webster" size={104} variant={0} />
            </View>
            <View style={styles.sleeveFront}>
              <SleeveArt title="Members Only" artist="—" size={132} variant={1} />
            </View>
            <View style={styles.sleeveBackRight}>
              <SleeveArt title="Late Broadcast" artist="Vol. III" size={104} variant={2} />
            </View>
          </View>

          {/* Masthead */}
          <View style={styles.masthead}>
            <Text style={styles.kicker}>MEMBER ENTRANCE · EST. 2026</Text>
            <Text style={styles.wordmark}>ONAY</Text>
            <Text style={styles.tagline}>The set’s already spinning. Come in.</Text>
          </View>

          {/* Form column */}
          <View style={styles.form}>
            {mode === 'social' && (
              <>
                <SocialBtn
                  kind="filled"
                  label="CONTINUE — APPLE"
                  onPress={handleAppleSignIn}
                  disabled={loading}
                  icon={<Ionicons name="logo-apple" size={16} color={AM.bgDeep} />}
                />
                <SocialBtn
                  label="CONTINUE — GOOGLE"
                  onPress={handleGoogleSignIn}
                  disabled={loading}
                  icon={<Ionicons name="logo-google" size={15} color={AM.ink} />}
                />

                <View style={styles.divider}>
                  <View style={styles.dividerLine} />
                  <Text style={styles.dividerText}>OR</Text>
                  <View style={styles.dividerLine} />
                </View>

                <Pressable
                  onPress={() => setMode('email')}
                  accessibilityRole="button"
                  accessibilityLabel="Sign in with email"
                  hitSlop={8}
                  style={({ pressed }) => [styles.emailLink, pressed && { opacity: 0.6 }]}
                >
                  <Text style={styles.emailLinkText}>SIGN IN WITH EMAIL →</Text>
                </Pressable>
              </>
            )}

            {mode === 'email' && (
              <>
                <Field
                  label="EMAIL"
                  type="email-address"
                  value={email}
                  onChangeText={setEmail}
                  returnKeyType="next"
                  onSubmitEditing={() => passwordRef.current?.focus()}
                />
                <Field
                  label={isSignUp ? 'NEW PASSWORD' : 'PASSWORD'}
                  inputRef={passwordRef}
                  secure
                  value={password}
                  onChangeText={setPassword}
                  returnKeyType="go"
                  onSubmitEditing={handleEmailAuth}
                  trailing={
                    !isSignUp ? (
                      <Pressable
                        onPress={handleForgotPassword}
                        accessibilityRole="button"
                        accessibilityLabel="Forgot password"
                        hitSlop={8}
                      >
                        <Text style={styles.forgotText}>FORGOT?</Text>
                      </Pressable>
                    ) : null
                  }
                />

                <Pressable
                  onPress={handleEmailAuth}
                  disabled={loading || !email.trim() || !password.trim()}
                  accessibilityRole="button"
                  accessibilityLabel={isSignUp ? 'Create account' : 'Sign in'}
                  style={({ pressed }) => [
                    styles.enterBtn,
                    (loading || !email.trim() || !password.trim()) && { opacity: 0.35 },
                    pressed && { opacity: 0.85 },
                  ]}
                >
                  <Tick pos="tl" color={AM.amber} bg={AM.bg} />
                  <Tick pos="tr" color={AM.amber} bg={AM.bg} />
                  <Tick pos="bl" color={AM.amber} bg={AM.bg} />
                  <Tick pos="br" color={AM.amber} bg={AM.bg} />
                  <View style={styles.enterBtnCenter}>
                    <Text style={styles.enterBtnLabel}>
                      {loading ? 'ONE MOMENT…' : isSignUp ? 'CREATE ACCOUNT' : 'ENTER'}
                    </Text>
                    <Text style={styles.enterBtnSub}>
                      {isSignUp ? 'NEW MEMBER CARD' : 'MEMBER SIGN IN'}
                    </Text>
                  </View>
                  <Text style={styles.enterBtnArrow}>→</Text>
                </Pressable>

                <Pressable
                  onPress={() => setMode('social')}
                  accessibilityRole="button"
                  accessibilityLabel="Back to Apple and Google sign-in"
                  hitSlop={8}
                  style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.6 }]}
                >
                  <Text style={styles.backBtnText}>← BACK TO APPLE / GOOGLE</Text>
                </Pressable>
              </>
            )}

            {/* New-member path */}
            <Pressable
              onPress={() => setIsSignUp(!isSignUp)}
              accessibilityRole="button"
              accessibilityLabel="Toggle sign up"
              style={({ pressed }) => [styles.member, pressed && { opacity: 0.6 }]}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.memberKicker}>
                  {isSignUp ? 'ALREADY A MEMBER?' : 'NEW AROUND HERE?'}
                </Text>
                <Text style={styles.memberText}>
                  {isSignUp ? 'Sign in →' : 'Become a member →'}
                </Text>
              </View>
              <Text style={styles.memberNo}>B·00</Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Auth overlay — spinning vinyl while we hit Firebase. Blocks the form. */}
      {loading && (
        <View style={styles.authOverlay} pointerEvents="auto">
          <SpinningRecord size={160} />
          <View style={styles.authTextBlock}>
            <Text style={styles.authLabel}>CHECKING YOUR MEMBERSHIP</Text>
            <Text style={styles.authVoice}>“the librarian’s on it…”</Text>
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

// ─────────────── Bits ───────────────

function SocialBtn({
  label,
  onPress,
  disabled,
  icon,
  kind = 'ghost',
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  icon?: React.ReactNode;
  kind?: 'ghost' | 'filled';
}) {
  const filled = kind === 'filled';
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.social,
        { backgroundColor: filled ? AM.ink : 'transparent', borderColor: filled ? AM.ink : AM.amberDim },
        disabled && { opacity: 0.4 },
        pressed && { opacity: 0.85 },
      ]}
    >
      <Tick pos="tl" color={filled ? AM.bgDeep : AM.amberDim} bg={filled ? AM.ink : AM.bg} />
      <Tick pos="tr" color={filled ? AM.bgDeep : AM.amberDim} bg={filled ? AM.ink : AM.bg} />
      <Tick pos="bl" color={filled ? AM.bgDeep : AM.amberDim} bg={filled ? AM.ink : AM.bg} />
      <Tick pos="br" color={filled ? AM.bgDeep : AM.amberDim} bg={filled ? AM.ink : AM.bg} />
      <Text style={[styles.socialLabel, { color: filled ? AM.bgDeep : AM.ink }]}>{label}</Text>
      <View>{icon}</View>
    </Pressable>
  );
}

function Field({
  label,
  value,
  onChangeText,
  type,
  secure,
  inputRef,
  returnKeyType,
  onSubmitEditing,
  trailing,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  type?: 'email-address' | 'default';
  secure?: boolean;
  inputRef?: React.Ref<TextInputType>;
  returnKeyType?: 'go' | 'next' | 'done';
  onSubmitEditing?: () => void;
  trailing?: React.ReactNode;
}) {
  const [focused, setFocused] = useState(false);

  return (
    <View style={[styles.field, { borderBottomColor: focused ? AM.amber : AM.amberDim }]}>
      <View style={styles.fieldLabelRow}>
        <Text style={[styles.fieldLabel, focused && { color: AM.amber }]}>{label}</Text>
        {trailing}
      </View>
      <TextInput
        ref={inputRef}
        value={value}
        onChangeText={onChangeText}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        keyboardType={type ?? 'default'}
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry={secure}
        returnKeyType={returnKeyType}
        onSubmitEditing={onSubmitEditing}
        blurOnSubmit={returnKeyType !== 'next'}
        style={styles.fieldInput}
        accessibilityLabel={label}
      />
    </View>
  );
}

// ─────────────── Styles ───────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: AM.bg },
  flex: { flex: 1 },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: Space.s22,
    paddingTop: Space.s30,
    paddingBottom: Space.s30,
  },

  sleeveTrio: {
    height: 160,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  sleeveBackLeft: {
    position: 'absolute',
    transform: [{ translateX: -48 }, { rotate: '-9deg' }],
    opacity: 0.55,
  },
  sleeveBackRight: {
    position: 'absolute',
    transform: [{ translateX: 48 }, { rotate: '8deg' }],
    opacity: 0.55,
  },
  sleeveFront: {
    zIndex: 2,
  },

  masthead: {
    marginTop: Space.s30,
    alignItems: 'center',
  },
  kicker: {
    fontFamily: Fonts.mono,
    fontSize: 9,
    color: AM.amberDim,
    letterSpacing: 4,
  },
  wordmark: {
    marginTop: Space.s10,
    fontFamily: Fonts.display,
    fontSize: TypeScale.s56,
    color: AM.ink,
    letterSpacing: 1,
    lineHeight: TypeScale.s56 * 0.9,
  },
  tagline: {
    marginTop: Space.s8,
    fontFamily: Fonts.serif,
    fontStyle: 'italic',
    fontSize: TypeScale.s13,
    color: AM.inkMid,
  },

  form: {
    marginTop: Space.s30,
    gap: 12,
  },

  social: {
    position: 'relative',
    paddingVertical: Space.s16,
    paddingHorizontal: Space.s18,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  socialLabel: {
    fontFamily: Fonts.display,
    fontSize: TypeScale.s14,
    letterSpacing: 1.5,
  },

  divider: {
    marginVertical: Space.s6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  dividerLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: AM.inkGhost,
  },
  dividerText: {
    fontFamily: Fonts.mono,
    fontSize: 9,
    color: AM.inkDim,
    letterSpacing: 3,
  },

  emailLink: {
    alignItems: 'center',
    paddingVertical: Space.s8,
  },
  emailLinkText: {
    fontFamily: Fonts.mono,
    fontSize: 10,
    color: AM.ink,
    letterSpacing: 2.5,
  },

  field: {
    paddingBottom: 6,
    borderBottomWidth: 1,
    gap: 4,
  },
  fieldLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  fieldLabel: {
    fontFamily: Fonts.mono,
    fontSize: 9,
    color: AM.inkDim,
    letterSpacing: 2.5,
  },
  forgotText: {
    fontFamily: Fonts.mono,
    fontSize: 9,
    color: AM.amber,
    letterSpacing: 2,
  },
  fieldInput: {
    fontFamily: Fonts.display,
    fontSize: TypeScale.s18,
    color: AM.ink,
    letterSpacing: 1,
    padding: 0,
    margin: 0,
  },

  enterBtn: {
    marginTop: Space.s10,
    position: 'relative',
    paddingVertical: Space.s16,
    paddingHorizontal: Space.s18,
    borderWidth: 1.5,
    borderColor: AM.amber,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  enterBtnCenter: {
    flex: 1,
  },
  enterBtnLabel: {
    fontFamily: Fonts.display,
    fontSize: TypeScale.s20,
    color: AM.amber,
    letterSpacing: 2,
  },
  enterBtnSub: {
    marginTop: 4,
    fontFamily: Fonts.mono,
    fontSize: 9,
    color: AM.inkDim,
    letterSpacing: 2,
  },
  enterBtnArrow: {
    fontFamily: Fonts.display,
    fontSize: 24,
    color: AM.amber,
  },

  backBtn: {
    marginTop: Space.s4,
    alignItems: 'center',
    paddingVertical: Space.s8,
  },
  backBtnText: {
    fontFamily: Fonts.mono,
    fontSize: 9,
    color: AM.inkDim,
    letterSpacing: 2,
  },

  member: {
    marginTop: Space.s18,
    paddingTop: Space.s14,
    borderTopWidth: 1,
    borderTopColor: AM.inkGhost,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  memberKicker: {
    fontFamily: Fonts.mono,
    fontSize: 9,
    color: AM.amberDim,
    letterSpacing: 2.5,
  },
  memberText: {
    marginTop: 2,
    fontFamily: Fonts.serif,
    fontStyle: 'italic',
    fontSize: TypeScale.s14,
    color: AM.ink,
  },
  memberNo: {
    fontFamily: Fonts.mono,
    fontSize: 9,
    color: AM.inkDim,
    letterSpacing: 2,
  },

  authOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(5, 4, 3, 0.94)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: ZIndex.tuning,
  },
  authTextBlock: {
    marginTop: Space.s30,
    alignItems: 'center',
  },
  authLabel: {
    fontFamily: Fonts.mono,
    fontSize: 10,
    color: AM.amberDim,
    letterSpacing: 3,
  },
  authVoice: {
    marginTop: Space.s8,
    fontFamily: Fonts.serif,
    fontStyle: 'italic',
    fontSize: TypeScale.s14,
    color: AM.inkMid,
  },
});
