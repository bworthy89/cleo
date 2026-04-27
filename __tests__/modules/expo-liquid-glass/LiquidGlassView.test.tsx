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
