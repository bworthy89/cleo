// Minimal react-native mock for Jest — covers what @testing-library/react-native
// needs when running tests in a Node environment.
import React from 'react';

export const StyleSheet = {
  create: (styles: Record<string, unknown>) => styles,
  flatten: (style: unknown) => (Array.isArray(style) ? Object.assign({}, ...style) : style ?? {}),
  hairlineWidth: 1,
  absoluteFill: {},
  absoluteFillObject: { position: 'absolute', top: 0, left: 0, bottom: 0, right: 0 },
};

// react-test-renderer expects component instances, not plain DOM elements
export const View: any = React.forwardRef(({ testID, style, ...props }: any, ref: any) =>
  React.createElement('RCTView', { testID, ...props }, props.children)
);
View.displayName = 'View';

export const Text: any = React.forwardRef(({ testID, style, ...props }: any, ref: any) =>
  React.createElement('RCTText', { testID, ...props }, props.children)
);
Text.displayName = 'Text';
