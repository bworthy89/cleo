# Fastlane Snapshot — one-time setup

This is the manual setup that has to happen once on each machine that captures
screenshots. Everything code-side (`UITEST_MODE` flag, fixtures, gates,
navigation script, `Snapfile`, `Fastfile`) is already wired up in-repo.

## 1. Create the UI Test target

1. Open `ios/ONAY.xcworkspace` in Xcode.
2. **File ▸ New ▸ Target… ▸ iOS ▸ UI Testing Bundle** ▸ **Next**.
3. Settings:
   - Product Name: `ONAYUITests`
   - Team: same as `ONAY` (`8F2VWCN5KF`). Xcode 26 occasionally auto-picks
     `5MQ5ZR66YN` — fix immediately under **Signing & Capabilities** if so.
   - Organization Identifier: `com.worthymedia.cleo`
   - Language: Swift
   - Project: `ONAY`
   - Target to be Tested: `ONAY`
4. Click **Finish**.

> **Heads-up — Xcode 26 quirks:**
> - The product name "ONAYUITests" is stored as **`ONAYUiTests`** (lowercase
>   second `i`) inside the pbxproj. The on-disk directory is still
>   `ios/ONAYUITests/` because macOS APFS is case-insensitive, but the target
>   name and bundle ID end up as `ONAYUiTests` /
>   `com.worthymedia.cleo.ONAYUiTests`. The Swift class in
>   `ONAYUITests.swift` is therefore named `ONAYUiTests` to match.
> - Xcode uses the new **`PBXFileSystemSynchronizedRootGroup`** for the test
>   target — every file in `ios/ONAYUITests/` is automatically a member of the
>   target with no manual "Add Files to…" step required. That's why this
>   runbook doesn't have one.

## 2. Replace Xcode's scaffold files

Xcode generated three scaffold files when you clicked Finish:

- `ONAYUITests.swift` (an empty `testExample` stub) — **overwritten** by the
  in-tree script you should already have on disk before you opened Xcode. If
  you opened Xcode first and the scaffold version is what's on disk now,
  restore the in-tree version from git: `git checkout ios/ONAYUITests/ONAYUITests.swift`
- `ONAYUiTestsLaunchTests.swift` (an `XCTApplicationLaunchMetric` perf test)
  — **delete it from disk**: `rm ios/ONAYUITests/ONAYUiTestsLaunchTests.swift`.
  The synchronized group drops it from the target automatically.
- `Info.plist` — Xcode's version is fine. The in-tree `Info.plist` is
  identical except for whitespace; either one works.

## 3. Confirm the scheme runs the test target

1. **Product ▸ Scheme ▸ Edit Scheme…** (⌘<).
2. Select the **ONAY** scheme.
3. **Test** action ▸ **Info** tab — `ONAYUiTests` should already be in the
   list (Xcode adds it automatically when you create the target). If it's
   not, click **+** to add it.
4. **Close**.

> The empty `ONAYTests` Apple-template unit test target is also in the test
> action — it has no test files and reports `passed (0 tests)`. Harmless;
> ignore unless you want to clean up later.
>
> Snapfile uses `scheme("ONAY")` — the app's main scheme with the test action
> populated, NOT a separate UITest scheme. `fastlane snapshot` invokes
> `xcodebuild test` against that scheme.

## 4. Commit the pbxproj change

The target addition modifies `ios/ONAY.xcodeproj/project.pbxproj`. Commit it
alongside the in-tree Swift files:

```sh
git add ios/ONAY.xcodeproj/project.pbxproj ios/ONAYUITests fastlane src
git commit -m "feat(uitest): add ONAYUITests target + fastlane snapshot lane"
```

`ios/` is tracked in this repo (build-59 cleanup), so the pbxproj change ships
to EAS — that's fine, the test target is benign in production builds.

## 5. (One-time per run) start Metro with the UITEST flag

The `UITEST_MODE` flag is gated on `__DEV__ && EXPO_PUBLIC_UITEST_MODE === 'true'`.
`__DEV__` is true in any Debug build, including the Debug build that
`fastlane snapshot` produces. The env var has to be set when Metro bundles the
JS.

Open a separate terminal:

```sh
EXPO_PUBLIC_UITEST_MODE=true npx expo start --dev-client --clear
```

Leave it running.

## 6. Run snapshot

In a second terminal at the project root:

```sh
bundle exec fastlane snapshot_capture
```

That drives the simulators in the Snapfile matrix, captures four PNGs each
(`01_home`, `02_setup_vibe`, `03_ask_onay`, `04_profile`), and writes them to
`fastlane/screenshots/en-US/`.

When the matrix completes, frame + upload as usual:

```sh
bundle exec fastlane frame
bundle exec fastlane upload
```

## Troubleshooting

- **All four screenshots are the login screen**: Metro isn't running, or wasn't
  started with `EXPO_PUBLIC_UITEST_MODE=true`. The app fell back to the real
  Firebase auth check, which has no signed-in user on a fresh sim.
- **Test fails with "Tab bar never appeared"**: same root cause. Check the
  simulator manually — if you see the login screen, the env wasn't picked up.
- **Test fails on `vibeRow.waitForExistence`**: the VIBE CatalogRow on Home
  carries `testID="home-setup-vibe-row"`. If a refactor drops or renames that
  prop, the Swift selector needs to follow. Identifier lives at
  `src/screens/home/HomeBroadcastScreen.tsx`; selector lives at
  `ios/ONAYUITests/ONAYUITests.swift`.
- **Build error: "Cannot find 'setupSnapshot' in scope"**: `SnapshotHelper.swift`
  isn't a member of the `ONAYUiTests` target. With `PBXFileSystemSynchronizedRootGroup`
  it should auto-include — confirm the file is at `ios/ONAYUITests/SnapshotHelper.swift`
  and not somewhere else.
- **Two test classes named `ONAYUiTests`**: Xcode's scaffold and the in-tree
  script both registered. Delete `ONAYUiTestsLaunchTests.swift` if it came back
  and confirm `ONAYUITests.swift` has only one `final class ONAYUiTests`.
- **`xcodebuild` complains the simulator runtime is missing**: Xcode ▸ Settings ▸
  Platforms — download the iOS 18 sim runtime, then retry.
- **Player + speaking screens are still missing**: those need a real bake
  against the dev server. Capture them by hand from a live broadcast on a
  Debug build, drop the PNGs into `fastlane/screenshots/en-US/` alongside the
  automated four, then run `frame` + `upload`.
