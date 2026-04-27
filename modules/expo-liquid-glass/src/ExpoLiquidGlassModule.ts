import { requireNativeModule, requireNativeViewManager } from 'expo-modules-core';

const ExpoLiquidGlass = requireNativeModule('ExpoLiquidGlass');
const NativeLiquidGlassView = requireNativeViewManager('ExpoLiquidGlass');

export default ExpoLiquidGlass;
export { NativeLiquidGlassView };
