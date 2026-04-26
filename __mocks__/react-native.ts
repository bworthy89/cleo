// Minimal react-native mock for Jest — covers what @testing-library/react-native
// needs when running renderHook in a pure Node test environment.
export const StyleSheet = {
  create: (styles: Record<string, unknown>) => styles,
  flatten: (style: unknown) => (Array.isArray(style) ? Object.assign({}, ...style) : style ?? {}),
  hairlineWidth: 1,
  absoluteFill: {},
  absoluteFillObject: { position: 'absolute', top: 0, left: 0, bottom: 0, right: 0 },
};
