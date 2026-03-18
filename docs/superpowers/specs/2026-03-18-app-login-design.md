# App Login Design

**Date:** 2026-03-18
**Goal:** Add full authentication to Cleo — Sign in with Apple, Google sign-in, and email/password — using Firebase Auth.

---

## Problem

The app has no real authentication. User data (name, vibe, stations) is stored locally in MMKV with no account system. There's no login, logout, or way to identify users. The backend Express server has no auth middleware — all routes are open.

---

## Auth Flow

1. App launches → check Firebase Auth state via `onAuthStateChanged`
2. **Not logged in** → auth screen with three options: Sign in with Apple, Sign in with Google, Email/Password (sign up / sign in toggle)
3. **First login** (no local profile) → existing onboarding flow (welcome → music auth → vibe setup → first station)
4. **Returning login** (local profile exists) → straight to main app
5. **Logout** → clear MMKV local data, Firebase sign out, return to auth screen
6. **Forgot password** → Firebase handles via email link (no custom screen needed, just a "Forgot password?" button on the auth screen)

Login is the new entry point. Existing local data is not migrated — users start fresh after login. **Note:** For users who used the app before auth was added, logout will clear their pre-existing stations and history. This is intentional — no migration path.

---

## Backend Changes

**New dependency:** `firebase-admin`

**Auth middleware:**
- Validates Firebase ID token from `Authorization: Bearer <token>` header
- Applied to all API routes: `/generate-segment`, `/synthesize-voice`, `/enrich-track`, `/musicbrainz`
- **Excluded:** `/health` endpoint stays unguarded (needed for monitoring and future Railway health checks)
- Returns 401 if token is missing or invalid

**Firebase admin setup:**
- Service account key stored in `server/.env` as `FIREBASE_SERVICE_ACCOUNT` — base64-encoded JSON string (multi-line JSON doesn't work in .env files)
- Initialize `firebase-admin` in server startup, decode the base64 env var to get the credentials

**What doesn't change:**
- Route logic (just guarded by auth)
- Rate limiting, CORS
- API keys in `server/.env`
- No user database on the server — Firebase manages user records

---

## Client-Side Implementation

### New Dependencies

- `@react-native-firebase/app` — Firebase core SDK
- `@react-native-firebase/auth` — Firebase Auth (includes Apple sign-in support via native iOS APIs)
- `@react-native-google-signin/google-signin` — Google sign-in for React Native

### Expo Config Plugins

Add to `app.json` plugins array:
```json
"plugins": [
  "@react-native-firebase/app",
  "@react-native-firebase/auth",
  "@react-native-google-signin/google-signin"
]
```

These config plugins handle:
- Linking `GoogleService-Info.plist` into the Xcode build
- Adding the `REVERSED_CLIENT_ID` URL scheme automatically
- **Do NOT manually add URL schemes in Xcode** — the config plugin manages this

### Entitlements

Add Sign in with Apple entitlement to `app.json`:
```json
"entitlements": {
  "com.apple.developer.musickit": ["music-items"],
  "com.apple.developer.applesignin": ["Default"]
}
```

### Token Handling

`api.ts` must call `firebase.auth().currentUser.getIdToken()` before each API request — **not** cache a token string. Firebase's `getIdToken()` automatically refreshes the token when it has less than 5 minutes remaining. ID tokens expire after 1 hour, and since radio sessions can run for hours, caching a token would cause silent 401 failures.

### Apple Sign-In Nonce

Apple sign-in requires a cryptographic nonce for replay attack prevention. `AuthService.ts` must:
1. Generate a random nonce string
2. SHA-256 hash it
3. Pass the hash to Apple's `ASAuthorizationController`
4. Pass the original nonce to Firebase's `appleAuth` credential creation

### Google Sign-In webClientId

`@react-native-google-signin` requires the `webClientId` (OAuth 2.0 web client ID from Google Cloud Console) — this is the web app client ID from the Firebase project, not the iOS client ID. Configure in `AuthService.ts` when initializing Google Sign-In.

### New Files

| File | Purpose |
|------|---------|
| `src/services/AuthService.ts` | Wraps Firebase Auth: sign in (Apple/Google/email), sign out, auth state listener, get ID token. Handles Apple nonce generation, Google webClientId config |
| `app/(auth)/login.tsx` | Auth screen with three sign-in buttons and email/password form |

### Modified Files

| File | Change |
|------|--------|
| `app/index.tsx` | Check Firebase auth state instead of just `getUser()`. Routes: no auth → login, auth + no profile → onboarding, auth + profile → main |
| `src/services/api.ts` | Call `getIdToken()` before each request, attach as `Authorization: Bearer <token>` header |
| `app/(settings)/profile.tsx` | Add logout button |
| `app.json` | Add config plugins, Sign in with Apple entitlement |

### Auth State Flow

```
App Launch
  → firebase.auth().onAuthStateChanged
    → null → /(auth)/login
    → user exists → getUser() from MMKV
      → null → /(onboarding)/welcome (first login)
      → exists → /(main) (returning user)
```

---

## Firebase Project Setup (Manual)

These steps happen in the Firebase Console and Apple Developer portal before any code runs:

1. Create Firebase project
2. Register iOS app with bundle ID `com.worthymedia.cleo`
3. Enable sign-in providers: Email/Password, Apple, Google
4. Download `GoogleService-Info.plist` → place in project root (gitignored, config plugin links it)
5. In Apple Developer portal: enable Sign in with Apple capability for the app ID
6. In Firebase Console: configure Apple sign-in provider with the Services ID
7. Note the `webClientId` from Firebase Console → Authentication → Sign-in method → Google (this is the web client ID, not the iOS one)
8. Generate Firebase Admin service account key → base64-encode → add as `FIREBASE_SERVICE_ACCOUNT` in `server/.env`

**After installing packages:** A new dev client build is required (`expo prebuild` → rsync to no-spaces path → `pod install` → Xcode build). Firebase native modules do not work in Expo Go.

---

## Native Build Notes

Adding Firebase packages requires a native rebuild:
1. Run `expo prebuild` in the source repo
2. rsync to `/Users/kari/Documents/cleo-app/` (no-spaces path)
3. Verify `Cleo.entitlements` includes both `musickit` and `applesignin` entries
4. `pod install` in the `ios/` directory
5. Build from Xcode

---

## Files Changed Summary

| File | Change |
|------|--------|
| `src/services/AuthService.ts` | New — Firebase Auth wrapper |
| `app/(auth)/login.tsx` | New — login screen |
| `app/index.tsx` | Modified — Firebase auth state gating |
| `src/services/api.ts` | Modified — call getIdToken() per request |
| `app/(settings)/profile.tsx` | Modified — add logout |
| `app.json` | Modified — config plugins, entitlements |
| `server/src/index.ts` | Modified — initialize firebase-admin |
| `server/src/middleware/auth.ts` | New — token verification middleware |
| `server/src/routes/segment.ts` | Modified — apply auth middleware |
| `server/src/routes/voice.ts` | Modified — apply auth middleware |
| `server/src/routes/enrichment.ts` | Modified — apply auth middleware |
| `server/package.json` | Modified — add firebase-admin dependency |
| `package.json` | Modified — add Firebase and Google sign-in dependencies |

---

## What This Does NOT Include

- No user database on the server — Firebase handles user records
- No data sync/backup — local MMKV is still the source of truth for app data
- No Railway deployment — server stays on localhost for now
- No migration of pre-existing local data — fresh start after login (intentional)
- No custom password reset UI — Firebase email link handles it
