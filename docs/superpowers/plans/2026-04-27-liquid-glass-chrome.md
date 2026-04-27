# Liquid Glass on iOS 26 Chrome Surfaces — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply Apple's iOS 26 `UIGlassEffect` material to 4 persistent chrome surfaces (`TabBar`, `AppHeader`, `NowPlayingBar`, `OfflineBanner`) behind `#available(iOS 26, *)` runtime guards, with iOS 16.2 / 18 keeping their existing solid `AM.bg` chrome unchanged.

**Architecture:** A new focused Expo Modules native package (`modules/expo-liquid-glass`) exposes a single primitive `<LiquidGlassView />` that wraps `UIVisualEffectView`. The native view uses `if #available(iOS 26.0, *)` to conditionally apply `UIGlassEffect()` or fall back to a transparent effect. Crate Digger composition (Anton labels, Tick corners, hairlines, oxblood underlines) stays 100% in RN. A two-PR rollout separates the native module (PR 1) from consumer adoption across the 4 chrome surfaces (PR 2).

**Tech Stack:** Swift (UIKit `UIVisualEffectView` + `UIGlassEffect`), Expo Modules SDK 55 (`expo-modules-core`), TypeScript, React Native 0.83, Jest (smoke tests for JS wrapper only).

**Spec:** `docs/superpowers/specs/2026-04-27-liquid-glass-chrome-design.md`

**Issue:** [#51](https://github.com/bworthy89/cleo/issues/51)

---

## File Structure

### PR 1 — `feat(modules): expo-liquid-glass primitive`

**Branch:** `feat/expo-liquid-glass-module`

```
modules/expo-liquid-glass/
├── package.json                              [Create]
├── expo-module.config.json                   [Create]
├── index.tsx                                 [Create] — public API surface (JSX)
├── src/
│   └── ExpoLiquidGlassModule.ts              [Create] — requireNativeModule wrapper
├── ios/
│   ├── ExpoLiquidGlass.podspec               [Create]
│   ├── ExpoLiquidGlassModule.swift           [Create] — module definition
│   └── LiquidGlassView.swift                 [Create] — UIView subclass
└── README.md                                 [Create]

__mocks__/expo-liquid-glass.ts                [Create] — Jest mock
__tests__/modules/expo-liquid-glass/
└── LiquidGlassView.test.tsx                  [Create] — JS wrapper smoke test
```

### PR 2 — `feat(chrome): adopt Liquid Glass on iOS 26`

**Branch:** `feat/liquid-glass-chrome-adoption`

```
src/components/TabBar.tsx                     [Modify] — wrap with LiquidGlassView, gate bg
src/components/AppHeader.tsx                  [Modify] — wrap with LiquidGlassView
src/components/NowPlayingBar.tsx              [Modify] — wrap with LiquidGlassView, gate bg
src/components/OfflineBanner.tsx              [Modify] — wrap with LiquidGlassView, gate bg
```

---

# PR 1 — Native Module

## Task 1: Module scaffolding

**Files:**
- Create: `modules/expo-liquid-glass/package.json`
- Create: `modules/expo-liquid-glass/expo-module.config.json`
- Create: `modules/expo-liquid-glass/ios/ExpoLiquidGlass.podspec`

- [ ] **Step 1: Create branch**

```bash
cd /Users/kari/Documents/cleo-app
git checkout main
git pull origin main
git checkout -b feat/expo-liquid-glass-module
```

- [ ] **Step 2: Create `modules/expo-liquid-glass/package.json`**

```json
{"name":"expo-liquid-glass","version":"0.1.0","main":"index.tsx"}
```

(`.tsx` rather than `.ts` because the wrapper component returns JSX.)

- [ ] **Step 3: Create `modules/expo-liquid-glass/expo-module.config.json`**

```json
{
  "platforms": ["ios"],
  "ios": {
    "modules": ["ExpoLiquidGlassModule"]
  }
}
```

- [ ] **Step 4: Create `modules/expo-liquid-glass/ios/ExpoLiquidGlass.podspec`**

```ruby
require 'json'

Pod::Spec.new do |s|
  s.name           = 'ExpoLiquidGlass'
  s.version        = '0.1.0'
  s.summary        = 'Expo module exposing iOS 26 UIGlassEffect material to React Native'
  s.description    = 'Custom Expo native module wrapping UIVisualEffectView with iOS 26 UIGlassEffect, transparent fallback on iOS 16-18'
  s.author         = 'ONAY'
  s.homepage       = 'https://github.com/placeholder'
  s.platforms      = { :ios => '16.2' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = '**/*.{h,m,mm,swift,hpp,cpp}'
  s.frameworks = 'UIKit'
end
```

- [ ] **Step 5: Verify expo-modules-autolinking picks up the new module**

Run: `npx expo modules`
Expected: output includes `expo-liquid-glass` in the list of detected modules.

- [ ] **Step 6: Commit**

```bash
git add modules/expo-liquid-glass/package.json \
        modules/expo-liquid-glass/expo-module.config.json \
        modules/expo-liquid-glass/ios/ExpoLiquidGlass.podspec
git commit -m "feat(modules): scaffold expo-liquid-glass package"
```

---

## Task 2: Native `LiquidGlassView` Swift class

**Files:**
- Create: `modules/expo-liquid-glass/ios/LiquidGlassView.swift`

This task creates the actual UIView. No tests are possible — Swift code is exercised manually via the iOS app build + smoke test in Task 7.

- [ ] **Step 1: Create `modules/expo-liquid-glass/ios/LiquidGlassView.swift`**

```swift
import ExpoModulesCore
import UIKit

class LiquidGlassView: ExpoView {
  /// Underlying visual effect view — owns the glass material on iOS 26+ and
  /// renders transparent on iOS 16-18. Sized to fill the host bounds.
  private let effectView: UIVisualEffectView

  /// Cached intensity so we can re-apply the effect when the prop changes.
  /// Defaults to "regular" — Apple's standard glass material.
  private var intensity: String = "regular"

  required init(appContext: AppContext? = nil) {
    self.effectView = UIVisualEffectView(effect: nil)
    super.init(appContext: appContext)
    addSubview(effectView)
    applyEffect()
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    effectView.frame = bounds
  }

  func setIntensity(_ value: String) {
    intensity = value
    applyEffect()
  }

  private func applyEffect() {
    if #available(iOS 26.0, *) {
      // UIGlassEffect is the iOS 26 system Liquid Glass material. The
      // initializer is non-throwing — if Apple's API ever fails it would do
      // so by returning a nil-effect view, which renders identically to the
      // iOS < 26 fallback (transparent passthrough). Intensity values aren't
      // currently differentiated; variable kept for forward-compat.
      effectView.effect = UIGlassEffect()
    } else {
      // iOS 16.2 / 18 fallback: transparent — host's parent provides the
      // background. Consumers gate their own solid background on the
      // isLiquidGlassAvailable JS constant.
      effectView.effect = nil
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add modules/expo-liquid-glass/ios/LiquidGlassView.swift
git commit -m "feat(modules): add LiquidGlassView native UIView"
```

---

## Task 3: Native module definition

**Files:**
- Create: `modules/expo-liquid-glass/ios/ExpoLiquidGlassModule.swift`

Registers the view with Expo Modules and exposes the `isAvailable` constant + `intensity` prop.

- [ ] **Step 1: Create `modules/expo-liquid-glass/ios/ExpoLiquidGlassModule.swift`**

```swift
import ExpoModulesCore
import UIKit

public class ExpoLiquidGlassModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ExpoLiquidGlass")

    // Compile-time iOS version check exposed to JS as a boolean constant.
    // JS consumers gate their solid-background fallback on this rather than
    // sniffing Platform.Version.
    Constants([
      "isAvailable": {
        if #available(iOS 26.0, *) { return true }
        return false
      }()
    ])

    View(LiquidGlassView.self) {
      Prop("intensity") { (view: LiquidGlassView, value: String) in
        view.setIntensity(value)
      }
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add modules/expo-liquid-glass/ios/ExpoLiquidGlassModule.swift
git commit -m "feat(modules): register ExpoLiquidGlass module + view"
```

---

## Task 4: JS-side wrapper

**Files:**
- Create: `modules/expo-liquid-glass/src/ExpoLiquidGlassModule.ts`
- Create: `modules/expo-liquid-glass/index.ts`

- [ ] **Step 1: Create `modules/expo-liquid-glass/src/ExpoLiquidGlassModule.ts`**

```ts
import { requireNativeModule, requireNativeView } from 'expo-modules-core';

const ExpoLiquidGlass = requireNativeModule('ExpoLiquidGlass');
const NativeLiquidGlassView = requireNativeView('ExpoLiquidGlass');

export default ExpoLiquidGlass;
export { NativeLiquidGlassView };
```

- [ ] **Step 2: Create `modules/expo-liquid-glass/index.tsx`**

```tsx
import type { ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import ExpoLiquidGlass, { NativeLiquidGlassView } from './src/ExpoLiquidGlassModule';

/**
 * `true` on iOS 26+, `false` on iOS 16-18. Computed once at module load via
 * `if #available(iOS 26.0, *)` on the native side. Consumers should gate
 * their solid-background fallback on this rather than sniffing the OS
 * version themselves.
 */
export const isLiquidGlassAvailable: boolean = ExpoLiquidGlass.isAvailable === true;

export type LiquidGlassIntensity = 'regular' | 'thin' | 'ultraThin';

export interface LiquidGlassViewProps {
  intensity?: LiquidGlassIntensity;
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
}

/**
 * Wraps children with iOS 26 Liquid Glass (UIGlassEffect) when available;
 * renders a transparent passthrough on iOS 16-18. Wrapped content should
 * use `backgroundColor: 'transparent'` (or gate on `isLiquidGlassAvailable`)
 * so the glass material has something to refract.
 */
export function LiquidGlassView(props: LiquidGlassViewProps) {
  return (
    <NativeLiquidGlassView
      intensity={props.intensity ?? 'regular'}
      style={props.style}
    >
      {props.children}
    </NativeLiquidGlassView>
  );
}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "expo-liquid-glass|LiquidGlass" | head`
Expected: empty output (no type errors in the new module).

- [ ] **Step 4: Commit**

```bash
git add modules/expo-liquid-glass/src/ExpoLiquidGlassModule.ts \
        modules/expo-liquid-glass/index.tsx
git commit -m "feat(modules): expo-liquid-glass JS wrapper + isLiquidGlassAvailable"
```

---

## Task 5: Jest mock + smoke test

**Files:**
- Create: `__mocks__/expo-liquid-glass.ts`
- Create: `__tests__/modules/expo-liquid-glass/LiquidGlassView.test.tsx`

The Jest test verifies the JS wrapper renders without throwing and that children pass through. Native Swift code can't be exercised here.

- [ ] **Step 1: Create `__mocks__/expo-liquid-glass.ts`**

```ts
import * as React from 'react';
import { View } from 'react-native';

export const isLiquidGlassAvailable = false;

export type LiquidGlassIntensity = 'regular' | 'thin' | 'ultraThin';

export interface LiquidGlassViewProps {
  intensity?: LiquidGlassIntensity;
  style?: any;
  children?: React.ReactNode;
}

export function LiquidGlassView(props: LiquidGlassViewProps) {
  // Render a plain View so children appear in the test tree. Tests against
  // chrome surfaces don't need to know about the native effect — they just
  // need the wrapper to be transparent in the test runtime.
  return React.createElement(View, { style: props.style, testID: 'mock-liquid-glass' }, props.children);
}
```

- [ ] **Step 2: Write the failing test**

Create `__tests__/modules/expo-liquid-glass/LiquidGlassView.test.tsx`:

```tsx
import * as React from 'react';
import { Text } from 'react-native';
import { render } from '@testing-library/react-native';
import { LiquidGlassView, isLiquidGlassAvailable } from 'expo-liquid-glass';

describe('LiquidGlassView (JS wrapper)', () => {
  it('exposes isLiquidGlassAvailable as a boolean', () => {
    expect(typeof isLiquidGlassAvailable).toBe('boolean');
  });

  it('renders children inside the wrapper', () => {
    const { getByText } = render(
      <LiquidGlassView>
        <Text>chrome content</Text>
      </LiquidGlassView>
    );
    expect(getByText('chrome content')).toBeTruthy();
  });

  it('accepts intensity prop without throwing', () => {
    expect(() => render(
      <LiquidGlassView intensity="thin">
        <Text>x</Text>
      </LiquidGlassView>
    )).not.toThrow();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test -- __tests__/modules/expo-liquid-glass/LiquidGlassView.test.tsx`
Expected: FAIL with `Cannot find module 'expo-liquid-glass'` (the project's Jest config doesn't yet know to resolve it).

- [ ] **Step 4: Confirm Jest moduleNameMapper picks up the new mock**

Inspect `jest.config.js` (or `package.json` jest section) for the existing `__mocks__/<package>.ts` resolution pattern. The convention is automatic: any file in `__mocks__/<name>.ts` mocks `import from '<name>'`. Verify by re-running:

Run: `npm test -- __tests__/modules/expo-liquid-glass/LiquidGlassView.test.tsx`
Expected: PASS — the 3 assertions all succeed.

If it still fails to resolve, check `jest.config.js` `moduleDirectories` or `moduleNameMapper` — there may be an explicit entry needed for `modules/*` packages. Add a mapping if missing:

```js
moduleNameMapper: {
  '^expo-liquid-glass$': '<rootDir>/__mocks__/expo-liquid-glass.ts',
}
```

Re-run to confirm green.

- [ ] **Step 5: Commit**

```bash
git add __mocks__/expo-liquid-glass.ts \
        __tests__/modules/expo-liquid-glass/LiquidGlassView.test.tsx
git commit -m "test(modules): smoke tests for LiquidGlassView JS wrapper"
```

---

## Task 6: README

**Files:**
- Create: `modules/expo-liquid-glass/README.md`

- [ ] **Step 1: Create `modules/expo-liquid-glass/README.md`**

```markdown
# expo-liquid-glass

Tiny Expo Modules wrapper exposing iOS 26 `UIGlassEffect` (Liquid Glass) to React Native.

## Usage

```tsx
import { LiquidGlassView, isLiquidGlassAvailable } from 'expo-liquid-glass';
import { View } from 'react-native';
import { AM } from '../tokens/design-tokens';

export function MyChrome() {
  return (
    <LiquidGlassView style={{ flex: 1 }}>
      <View style={{
        backgroundColor: isLiquidGlassAvailable ? 'transparent' : AM.bg,
      }}>
        {/* your chrome content */}
      </View>
    </LiquidGlassView>
  );
}
```

## API

### `LiquidGlassView`

Wraps children with `UIGlassEffect` on iOS 26+, renders transparent passthrough on iOS 16–18.

| Prop | Type | Default | Description |
|---|---|---|---|
| `intensity` | `'regular' \| 'thin' \| 'ultraThin'` | `'regular'` | Reserved for future `UIGlassEffect` differentiation; ignored today |
| `style` | `StyleProp<ViewStyle>` | — | Standard RN style |
| `children` | `ReactNode` | — | Content to render over the glass material |

### `isLiquidGlassAvailable: boolean`

`true` on iOS 26+, `false` on iOS 16–18. Computed once at module load via native `#available` check. Use this to gate solid background colors on chrome surfaces — when `false`, paint your own background; when `true`, set `backgroundColor: 'transparent'` so the glass material has content to refract.

## Constraints

- iOS only (Android renders nothing — the platform key in `expo-module.config.json` is `["ios"]`)
- Children must use `backgroundColor: 'transparent'` on iOS 26+ for the glass to refract anything
- v1 does not opt into Apple's interactive behaviors (deformation on tap, scroll-edge reactivity beyond automatic refraction). File a follow-up if needed.
```

- [ ] **Step 2: Commit**

```bash
git add modules/expo-liquid-glass/README.md
git commit -m "docs(modules): expo-liquid-glass README"
```

---

## Task 7: Manual iOS smoke test for PR 1

This task is the only validation that the Swift code actually works. Do not skip.

- [ ] **Step 1: Build the iOS app for the iOS 26 device**

```bash
cd /Users/kari/Documents/cleo-app
SENTRY_DISABLE_AUTO_UPLOAD=true npx expo run:ios --device
```

Expected: Build completes without compile errors. Specifically watch for Swift errors mentioning `LiquidGlassView`, `UIGlassEffect`, or `ExpoLiquidGlass.podspec`.

- [ ] **Step 2: Sanity-check the constant in the running app**

The cleanest way is via React Native debugger console once the app launches. Open Safari → Develop → [your device] → ONAY app → JavaScriptCore → console:

```js
require('expo-liquid-glass').isLiquidGlassAvailable
```

Expected on iOS 26: `true`. On iOS 16.2 / 18 simulator: `false`.

- [ ] **Step 3: Build for iOS 16.2 simulator**

In Xcode, switch active scheme to a 16.2 simulator and build. Expected: same successful build, no compile errors.

- [ ] **Step 4: Build for iOS 18 simulator**

Switch to an 18 simulator, build again. Expected: same.

- [ ] **Step 5: Run the JS smoke test one more time**

```bash
npm test -- __tests__/modules/expo-liquid-glass/LiquidGlassView.test.tsx
```

Expected: 3 assertions PASS.

---

## Task 8: Open PR 1

- [ ] **Step 1: Push branch**

```bash
git push -u origin feat/expo-liquid-glass-module
```

- [ ] **Step 2: Run CodeRabbit pre-PR review (per project convention)**

```bash
coderabbit review --agent --base main --type committed
```

Address any findings before opening the PR.

- [ ] **Step 3: Open PR**

```bash
gh pr create --title "feat(modules): expo-liquid-glass primitive (#51)" --body "$(cat <<'EOF'
## Summary

- New \`modules/expo-liquid-glass\` Expo Modules package
- Native \`LiquidGlassView\` wraps \`UIVisualEffectView\` with \`UIGlassEffect()\` on iOS 26+, transparent fallback on iOS 16-18
- \`isLiquidGlassAvailable\` boolean constant for JS consumers to gate solid-background fallbacks
- Static material only (refraction comes free; no deformation, scroll-edge, or tint behaviors in v1)
- Zero consumer-side changes — this PR is pure infrastructure. Adoption across the 4 chrome surfaces lands in the follow-up PR.

## Test plan

- [x] iOS 16.2 simulator build succeeds
- [x] iOS 18 simulator build succeeds
- [x] iOS 26 device build succeeds + \`isLiquidGlassAvailable === true\`
- [x] Jest smoke tests pass

## Spec / context

- Spec: \`docs/superpowers/specs/2026-04-27-liquid-glass-chrome-design.md\`
- Issue: #51
EOF
)"
```

---

# PR 2 — Consumer Adoption

## Task 9: Branch off updated main

- [ ] **Step 1: Wait for PR 1 to merge to main**

Check status: `gh pr view <PR-1-number> --json state,mergedAt`
Proceed only when `state` is `MERGED`.

- [ ] **Step 2: Create PR 2 branch**

```bash
git checkout main
git pull origin main
git checkout -b feat/liquid-glass-chrome-adoption
```

---

## Task 10: Wrap `TabBar`

**Files:**
- Modify: `src/components/TabBar.tsx`

Current state: `styles.container` has `backgroundColor: AM.bg` and `borderTopWidth: 0.5`. The container is positioned absolute at the bottom and contains `<NowPlayingBar />` + the tab `<View style={styles.inner}>`.

Strategy: wrap the entire container content in `<LiquidGlassView>` and gate `container.backgroundColor` on `isLiquidGlassAvailable`.

- [ ] **Step 1: Modify `src/components/TabBar.tsx`**

Add imports near the top:

```ts
import { LiquidGlassView, isLiquidGlassAvailable } from 'expo-liquid-glass';
```

Replace the JSX return body. Current shape:

```tsx
return (
  <View style={[styles.container, { paddingBottom: insets.bottom || Space.s18 }]}>
    <NowPlayingBar />
    <View style={styles.inner}>
      {/* ... tabs ... */}
    </View>
  </View>
);
```

New shape:

```tsx
return (
  <LiquidGlassView style={[styles.container, { paddingBottom: insets.bottom || Space.s18 }]}>
    <NowPlayingBar />
    <View style={styles.inner}>
      {/* ... tabs ... */}
    </View>
  </LiquidGlassView>
);
```

Update `styles.container.backgroundColor`:

```ts
const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: isLiquidGlassAvailable ? 'transparent' : AM.bg,
    borderTopWidth: 0.5,
    borderTopColor: AM.rule,
  },
  // ... rest unchanged
});
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep TabBar | head`
Expected: empty output.

- [ ] **Step 3: Commit**

```bash
git add src/components/TabBar.tsx
git commit -m "feat(chrome): wrap TabBar with LiquidGlassView for iOS 26"
```

---

## Task 11: Wrap `AppHeader`

**Files:**
- Modify: `src/components/AppHeader.tsx`

Current state: `styles.container` has `backgroundColor: 'transparent'` (already over `BroadcastBackdrop`). On iOS 26 we want the glass material to appear; on iOS < 26 it stays transparent (no change).

Strategy: wrap the container with `<LiquidGlassView>`. No background swap needed since current is already transparent — but we still want the glass refraction visible against the BroadcastBackdrop.

- [ ] **Step 1: Modify `src/components/AppHeader.tsx`**

Add imports:

```ts
import { LiquidGlassView } from 'expo-liquid-glass';
```

Replace the JSX return body. Current shape:

```tsx
return (
  <View style={[styles.container, { paddingTop: insets.top, height: HEADER_HEIGHT + insets.top }]}>
    <View style={styles.inner}>
      {/* ... wordmark + right ... */}
    </View>
  </View>
);
```

New shape:

```tsx
return (
  <LiquidGlassView style={[styles.container, { paddingTop: insets.top, height: HEADER_HEIGHT + insets.top }]}>
    <View style={styles.inner}>
      {/* ... wordmark + right ... */}
    </View>
  </LiquidGlassView>
);
```

`styles.container.backgroundColor` stays `'transparent'` — no change there.

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep AppHeader | head`
Expected: empty output.

- [ ] **Step 3: Commit**

```bash
git add src/components/AppHeader.tsx
git commit -m "feat(chrome): wrap AppHeader with LiquidGlassView for iOS 26"
```

---

## Task 12: Wrap `NowPlayingBar`

**Files:**
- Modify: `src/components/NowPlayingBar.tsx`

Current state: `styles.root` has `backgroundColor: AM.bg` and `borderTopWidth: 1`. The root is a `Pressable`.

Strategy: wrap the `Pressable` content. `Pressable` can take children; we wrap with `LiquidGlassView` outside to keep tap behavior on the same node, with the glass providing the background.

- [ ] **Step 1: Modify `src/components/NowPlayingBar.tsx`**

Add imports:

```ts
import { LiquidGlassView, isLiquidGlassAvailable } from 'expo-liquid-glass';
```

Update `styles.root.backgroundColor`:

```ts
const styles = StyleSheet.create({
  root: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.s14,
    paddingHorizontal: Space.s22,
    paddingVertical: Space.s10,
    backgroundColor: isLiquidGlassAvailable ? 'transparent' : AM.bg,
    borderTopWidth: 1,
    borderTopColor: AM.amberFaint,
  },
  // ... rest unchanged
});
```

Wrap the returned `Pressable`. Current shape:

```tsx
return (
  <Pressable
    onPress={onPress}
    accessibilityRole="button"
    accessibilityLabel={...}
    style={({ pressed }) => [styles.root, pressed && { opacity: 0.6 }]}
  >
    {/* ... children ... */}
  </Pressable>
);
```

New shape:

```tsx
return (
  <LiquidGlassView>
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={...}
      style={({ pressed }) => [styles.root, pressed && { opacity: 0.6 }]}
    >
      {/* ... children ... */}
    </Pressable>
  </LiquidGlassView>
);
```

The `LiquidGlassView` takes its size from the wrapped `Pressable`'s natural layout — no explicit style needed since the bar sizes itself by content.

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep NowPlayingBar | head`
Expected: empty output.

- [ ] **Step 3: Commit**

```bash
git add src/components/NowPlayingBar.tsx
git commit -m "feat(chrome): wrap NowPlayingBar with LiquidGlassView for iOS 26"
```

---

## Task 13: Wrap `OfflineBanner`

**Files:**
- Modify: `src/components/OfflineBanner.tsx`

Current state: `styles.banner` has `backgroundColor: Surface.high` (legacy alias mapping to `AM.bg`). Root is `Animated.View` for the slide-in transform.

Strategy: wrap the `Animated.View` so the glass material moves with the slide animation. Migrate the legacy `Surface`/`Colors`/`Typography`/`Spacing` aliases to the direct `AM` / `Fonts` / `Space` tokens at the same time — this file is the last user of those aliases in the chrome layer.

- [ ] **Step 1: Modify `src/components/OfflineBanner.tsx`**

Replace the imports section:

```ts
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View, Animated } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { AM, Fonts, Space } from '../tokens/design-tokens';
import { LiquidGlassView, isLiquidGlassAvailable } from 'expo-liquid-glass';
```

Replace the `OfflineBanner` JSX return:

```tsx
return (
  <Animated.View style={[styles.banner, { transform: [{ translateY }] }]}>
    <LiquidGlassView style={styles.glassFill}>
      <Text style={styles.text}>NO CONNECTION — MUSIC CONTINUES, ONAY IS QUIET</Text>
    </LiquidGlassView>
  </Animated.View>
);
```

(`LiquidGlassView` lives inside `Animated.View` so the slide transform applies to both the glass and the text together.)

Replace the styles block:

```ts
const styles = StyleSheet.create({
  banner: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: isLiquidGlassAvailable ? 'transparent' : AM.bg,
    zIndex: 100,
    borderBottomWidth: 1,
    borderBottomColor: AM.amber,
  },
  glassFill: {
    paddingVertical: Space.s10,
    paddingHorizontal: Space.s14,
    alignItems: 'center',
  },
  text: {
    fontFamily: Fonts.mono,
    fontSize: 9,
    letterSpacing: 2,
    color: AM.amber,
  },
});
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep OfflineBanner | head`
Expected: empty output.

- [ ] **Step 3: Verify no other consumers reference the legacy `Colors.accent` color**

Run: `grep -n "Colors.accent\|Surface.high\|Typography.mono" src/components/OfflineBanner.tsx`
Expected: empty output (this file no longer uses any legacy aliases).

- [ ] **Step 4: Commit**

```bash
git add src/components/OfflineBanner.tsx
git commit -m "feat(chrome): wrap OfflineBanner with LiquidGlassView + migrate legacy tokens"
```

---

## Task 14: iOS 16.2 + iOS 18 simulator smoke test

This validates the fallback path (`isLiquidGlassAvailable === false`).

- [ ] **Step 1: Build for iOS 16.2 simulator**

In Xcode, switch active scheme to an iOS 16.2 simulator. Build + run.

Expected:
- App launches, no crash on chrome surfaces
- `TabBar`, `NowPlayingBar`, `OfflineBanner` show their solid `AM.bg` warm-black background (visually identical to current `main`)
- `AppHeader` is transparent (visually identical to current `main`)
- All Crate Digger marks visible: Anton labels, mono numerals, oxblood underline on active tab, hairline rules, amber-faint border on NowPlayingBar

- [ ] **Step 2: Build for iOS 18 simulator**

Switch to an iOS 18 simulator. Same expectations.

---

## Task 15: iOS 26 device smoke test

This validates the actual Liquid Glass material renders correctly.

- [ ] **Step 1: Build + install on iOS 26 device**

```bash
SENTRY_DISABLE_AUTO_UPLOAD=true npx expo run:ios --device
```

- [ ] **Step 2: Smoke checklist on the device**

- [ ] Launch app, sit on home screen → `TabBar` + `AppHeader` visible
- [ ] Glass refraction visible on `TabBar` against `BroadcastBackdrop`'s amber bloom
- [ ] Crate Digger marks layer cleanly on top of glass: Anton tab labels, mono numerals (01, 02, 03, 04), oxblood underline on active tab, hairline rules between tabs
- [ ] Scroll the home content; glass should subtly react to content moving under it (free behavior from `UIGlassEffect`)
- [ ] Start a broadcast → `NowPlayingBar` appears between content and `TabBar`. Both glass surfaces stack cleanly with no z-order glitches
- [ ] Toggle airplane mode → `OfflineBanner` slides in from top with glass material; amber bottom border visible; "NO CONNECTION" text legible against the glass
- [ ] Open a modal sheet (`SetupSheet` from home, or `SettingsDrawer`) → sheets stay solid (not in scope), no visual regression
- [ ] Background the app, foreground it → chrome restores cleanly with glass intact

- [ ] **Step 3: If anything looks broken on iOS 26**

File the specific issue (which surface, what's wrong, screenshot). Do NOT proceed to opening PR 2 until all smoke items pass.

---

## Task 16: Open PR 2

- [ ] **Step 1: Push branch**

```bash
git push -u origin feat/liquid-glass-chrome-adoption
```

- [ ] **Step 2: Run CodeRabbit pre-PR review**

```bash
coderabbit review --agent --base main --type committed
```

Address any findings before opening the PR.

- [ ] **Step 3: Open PR**

```bash
gh pr create --title "feat(chrome): adopt Liquid Glass on iOS 26 chrome surfaces (#51)" --body "$(cat <<'EOF'
## Summary

Adopts the \`expo-liquid-glass\` primitive across 4 persistent chrome surfaces:

- \`TabBar\` — wrapped, background gated on \`isLiquidGlassAvailable\`
- \`AppHeader\` — wrapped, no background change (was already transparent)
- \`NowPlayingBar\` — wrapped, background gated
- \`OfflineBanner\` — wrapped, background gated, legacy \`Surface\`/\`Colors\`/\`Typography\` aliases migrated to direct \`AM\` / \`Fonts\` / \`Space\` tokens

iOS 16.2 / 18 see no visual change. iOS 26 gets Apple's \`UIGlassEffect\` material with Crate Digger marks layered on top.

Out of scope (per spec): all 3 modal sheets (\`SetupSheet\`, \`SettingsDrawer\`, \`PublishFeaturedSheet\`).

## Test plan

- [x] iOS 16.2 simulator: chrome visually identical to current \`main\`
- [x] iOS 18 simulator: same
- [x] iOS 26 device: glass material renders + refracts \`BroadcastBackdrop\`; Crate Digger marks layer cleanly; no z-order glitches; \`OfflineBanner\` glass survives slide animation

## Spec / context

- Spec: \`docs/superpowers/specs/2026-04-27-liquid-glass-chrome-design.md\`
- Issue: #51
- Native primitive: PR #<PR-1-number>
EOF
)"
```

---

## Self-Review Checklist (run after writing the plan, fix inline)

**Spec coverage:**

| Spec section | Implementing task(s) |
|---|---|
| Architecture / new module | Tasks 1, 2, 3, 4, 6 |
| `isLiquidGlassAvailable` constant | Task 3 (native), Task 4 (JS) |
| Data flow / consumer gating | Tasks 10, 12, 13 (each consumer uses the constant) |
| Error handling: iOS < 26 fallback | Task 2 (`effect = nil` else branch) |
| Error handling: `UIGlassEffect()` failure | Task 2 (Apple API non-throwing; nil-effect path is the natural fallback, identical to iOS < 26 visual) |
| Error handling: consumer doesn't go transparent | Task 6 (README documents the contract) |
| Test matrix iOS 16.2 / 18 / 26 | Tasks 7, 14, 15 |
| Manual smoke per OS | Tasks 14, 15 |
| Native module Jest smoke test | Task 5 |
| PR 1 — native module | Tasks 1–8 |
| PR 2 — consumer adoption | Tasks 9–16 |
| Static material v1, no behaviors | Task 2 (only `UIGlassEffect()`, no opt-in to deformation/scroll-edge) |
| `regular` intensity default | Task 4 (JS default), Task 6 (documented) |
| 4 surfaces in scope | Tasks 10–13 |
| Sheets out of scope | Verified by no Tasks touching `SetupSheet` / `SettingsDrawer` / `PublishFeaturedSheet` |
| Crate Digger marks stay in RN | Tasks 10–13 only swap backgrounds + wrap; no marks moved |

All spec sections accounted for.

**Placeholder scan:** All steps include exact code, exact paths, exact commands. No "TBD" / "TODO" / "implement later" / "handle edge cases" wording present.

**Type consistency:** `LiquidGlassIntensity` declared once in `index.tsx` and re-used in mock + tests. `isLiquidGlassAvailable` is `boolean` everywhere. Native `setIntensity(_ value: String)` matches JS `intensity?: LiquidGlassIntensity` (Strings on both sides).

---

## Open follow-up issues (file after PR 2 lands if needed)

- Modal sheets adoption (`SetupSheet`, `SettingsDrawer`, `PublishFeaturedSheet`)
- Apple's interactive behaviors (deformation on tap, scroll-edge effects, tint variants)
- Per-surface intensity tuning if `regular` doesn't work for all 4 surfaces
- Crate Digger soft refresh (#52) — already filed; this plan unblocks it
