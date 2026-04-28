# expo-liquid-glass

Tiny Expo Modules wrapper exposing iOS 26 `UIGlassEffect` (Liquid Glass) to React Native.

## Usage

```tsx
import { LiquidGlassView, isLiquidGlassAvailable } from '../../modules/expo-liquid-glass';
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
