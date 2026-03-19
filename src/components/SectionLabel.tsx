import React from 'react';
import { Text, type TextProps } from 'react-native';
import { Colors, Typography } from '../tokens/design-tokens';

interface SectionLabelProps extends TextProps {
  children: string;
  color?: string;
}

export function SectionLabel({ children, color = Colors.accent, style, ...props }: SectionLabelProps) {
  return (
    <Text
      style={[
        {
          fontFamily: Typography.mono.family,
          fontSize: 9,
          letterSpacing: 1.6,
          textTransform: 'uppercase',
          color,
          fontWeight: '500',
          marginBottom: 14,
        },
        style,
      ]}
      {...props}
    >
      {children}
    </Text>
  );
}
