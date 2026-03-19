---
name: sync-native
description: Sync Cleo source files to the no-spaces cleo-app build directory and run pod install
disable-model-invocation: true
---

# Sync Native

Syncs source from `DJ App/cleo/` to `/Users/kari/Documents/cleo-app/` (the no-spaces build path required by React Native pod scripts).

## Steps

1. **Rsync source** (excludes ios/ to preserve Xcode project state, excludes node_modules):
   ```bash
   rsync -av --delete \
     --exclude='ios/' \
     --exclude='node_modules/' \
     --exclude='.expo/' \
     "/Users/kari/Documents/DJ App/cleo/" /Users/kari/Documents/cleo-app/
   ```

2. **Sync native module separately** (Swift source + podspec only, not the whole ios/ tree):
   ```bash
   rsync -av \
     "/Users/kari/Documents/DJ App/cleo/modules/expo-music-kit/ios/" \
     /Users/kari/Documents/cleo-app/modules/expo-music-kit/ios/
   ```

3. **Install dependencies**:
   ```bash
   cd /Users/kari/Documents/cleo-app && npm install
   ```

4. **Pod install** (picks up native module changes):
   ```bash
   cd /Users/kari/Documents/cleo-app/ios && ~/.rbenv/shims/pod install
   ```

5. **Verify entitlements** are clean (empty dict, no musickit key):
   ```bash
   grep -c "musickit" /Users/kari/Documents/cleo-app/ios/Cleo/Cleo.entitlements && echo "WARNING: Remove musickit from entitlements!" || echo "Entitlements OK"
   ```

## When to use
- After editing Swift native module code
- After changing package.json dependencies
- After modifying expo-module config
- Before running `/build-ios`
