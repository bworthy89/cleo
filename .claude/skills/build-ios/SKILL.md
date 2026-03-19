---
name: build-ios
description: Sync Cleo source to no-spaces build path, pod install, and build to physical device
disable-model-invocation: true
---

# Build iOS

Full native build pipeline for Cleo. Handles the spaces-in-path constraint automatically.

## Steps

1. **Sync source to build directory** (spaces in "DJ App" break React Native pod scripts):
   ```bash
   rsync -av --delete \
     --exclude='ios/' \
     --exclude='node_modules/' \
     --exclude='.expo/' \
     "/Users/kari/Documents/DJ App/cleo/" /Users/kari/Documents/cleo-app/
   ```

2. **Install node modules** (if needed):
   ```bash
   cd /Users/kari/Documents/cleo-app && npm install
   ```

3. **Verify entitlements** — `Cleo.entitlements` must have empty `<dict/>` (no musickit key):
   ```bash
   cat /Users/kari/Documents/cleo-app/ios/Cleo/Cleo.entitlements
   ```
   If it contains `com.apple.developer.musickit`, remove that entry. MusicKit works via Info.plist, not entitlements.

4. **Pod install**:
   ```bash
   cd /Users/kari/Documents/cleo-app/ios && ~/.rbenv/shims/pod install
   ```

5. **Clear DerivedData** (only if CpResource or stale cache errors):
   ```bash
   rm -rf ~/Library/Developer/Xcode/DerivedData/Cleo-*
   ```

6. **Build and install to device**:
   ```bash
   cd /Users/kari/Documents/cleo-app && xcodebuild \
     -workspace ios/Cleo.xcworkspace \
     -configuration Debug \
     -scheme Cleo \
     -destination "id=00008120-000C7CAE1407601E" \
     DEVELOPMENT_TEAM=8F2VWCN5KF \
     -allowProvisioningUpdates \
     -allowProvisioningDeviceRegistration
   ```

7. **Sync any Xcode-generated changes back** (signing, entitlements):
   ```bash
   rsync -av /Users/kari/Documents/cleo-app/ios/ "/Users/kari/Documents/DJ App/cleo/ios/"
   ```

## Important
- iOS deployment target: 16.0
- Ruby: rbenv Ruby 3.2.4 (~/.rbenv/shims/pod)
- Team: 8F2VWCN5KF, Signing: bworthy89@gmail.com
- If build fails with privacy manifest errors, clear DerivedData (step 5) then re-run pod install + build
