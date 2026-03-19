import auth, { FirebaseAuthTypes } from '@react-native-firebase/auth';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';

// Configure Google Sign-In — webClientId from Firebase Console
GoogleSignin.configure({
  webClientId: '561205891522-vr5uph23gudgs8vu05kcv3g6uskb77dq.apps.googleusercontent.com',
});

export type AuthUser = FirebaseAuthTypes.User | null;

/**
 * Listen to Firebase auth state changes.
 * Returns an unsubscribe function.
 */
export function onAuthStateChanged(
  callback: (user: AuthUser) => void
): () => void {
  return auth().onAuthStateChanged(callback);
}

/**
 * Get the current user's ID token for API calls.
 * Always call this fresh — do NOT cache the token.
 * Firebase handles refresh automatically when token is near expiry.
 * ID tokens expire after 1 hour; radio sessions can run longer.
 */
export async function getIdToken(): Promise<string | null> {
  const user = auth().currentUser;
  if (!user) return null;
  return user.getIdToken();
}

/**
 * Sign in with email and password.
 */
export async function signInWithEmail(
  email: string,
  password: string
): Promise<FirebaseAuthTypes.UserCredential> {
  return auth().signInWithEmailAndPassword(email, password);
}

/**
 * Create account with email and password.
 */
export async function signUpWithEmail(
  email: string,
  password: string
): Promise<FirebaseAuthTypes.UserCredential> {
  return auth().createUserWithEmailAndPassword(email, password);
}

/**
 * Send password reset email.
 */
export async function sendPasswordReset(email: string): Promise<void> {
  return auth().sendPasswordResetEmail(email);
}

/**
 * Sign in with Google.
 */
export async function signInWithGoogle(): Promise<FirebaseAuthTypes.UserCredential> {
  await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
  const response = await GoogleSignin.signIn();
  if (!response.data?.idToken) {
    throw new Error('Google sign-in failed: no ID token');
  }
  const googleCredential = auth.GoogleAuthProvider.credential(response.data.idToken);
  return auth().signInWithCredential(googleCredential);
}

/**
 * Sign in with Apple.
 * Uses expo-apple-authentication to trigger the native sign-in sheet,
 * then passes the identity token and nonce to Firebase.
 */
export async function signInWithApple(): Promise<FirebaseAuthTypes.UserCredential> {
  // Generate a random nonce for replay attack prevention
  const rawNonce = Array.from(
    await Crypto.getRandomBytesAsync(32)
  ).map(b => b.toString(16).padStart(2, '0')).join('');

  // SHA-256 hash the nonce — Apple receives the hash, Firebase gets the raw
  const hashedNonce = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    rawNonce
  );

  // Trigger the native Apple sign-in sheet
  const appleCredential = await AppleAuthentication.signInAsync({
    requestedScopes: [
      AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
      AppleAuthentication.AppleAuthenticationScope.EMAIL,
    ],
    nonce: hashedNonce,
  });

  if (!appleCredential.identityToken) {
    throw new Error('Apple sign-in failed: no identity token');
  }

  // Create Firebase credential with the identity token and raw nonce
  const firebaseCredential = auth.AppleAuthProvider.credential(
    appleCredential.identityToken,
    rawNonce
  );

  return auth().signInWithCredential(firebaseCredential);
}

/**
 * Sign out of Firebase and all providers.
 */
export async function signOut(): Promise<void> {
  try {
    await GoogleSignin.signOut();
  } catch {
    // Google sign-out fails if user didn't sign in with Google — ignore
  }
  return auth().signOut();
}
