/**
 * Feature flags for toggling between music providers.
 *
 * Set to true to use Adaptr SDK instead of Apple MusicKit.
 * Flip back to false to restore Apple Music mode.
 */

export const USE_ADAPTR = true; // DEV: testing Adaptr integration

/**
 * UI-test / screenshot mode. Bypasses Firebase auth, Apple Music auth, and
 * the broadcast bake pipeline so Fastlane snapshot can drive the app
 * through deterministic fixture states without hitting the network.
 *
 * Activated only when BOTH conditions hold:
 *   1. __DEV__ is true (React Native global — true in Debug, false in Release)
 *   2. EXPO_PUBLIC_UITEST_MODE=true in the Metro env at build time
 *
 * The __DEV__ gate is the hard stop that makes it impossible for a
 * TestFlight or App Store build to activate this mode, even if the env
 * var leaks into the CI environment.
 */
export const UITEST_MODE =
  __DEV__ && process.env.EXPO_PUBLIC_UITEST_MODE === 'true';
