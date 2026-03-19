import React from 'react';
import Svg, { Path, Circle } from 'react-native-svg';

export type TabIconName = 'sensors' | 'timeline' | 'library_music' | 'blur_on';

interface TabIconProps {
  name: TabIconName;
  size?: number;
  color: string;
  filled?: boolean;
}

const icons: Record<TabIconName, { outlined: React.ReactNode; filled: React.ReactNode }> = {
  sensors: {
    outlined: (
      <>
        <Circle cx="12" cy="12" r="2" />
        <Path d="M8.46 14.77a4.98 4.98 0 0 1 0-5.54M15.54 9.23a4.98 4.98 0 0 1 0 5.54" strokeWidth="1.5" fill="none" />
        <Path d="M5.93 17.46a8.97 8.97 0 0 1 0-10.92M18.07 6.54a8.97 8.97 0 0 1 0 10.92" strokeWidth="1.5" fill="none" />
      </>
    ),
    filled: (
      <>
        <Circle cx="12" cy="12" r="3" />
        <Path d="M8.46 14.77a4.98 4.98 0 0 1 0-5.54M15.54 9.23a4.98 4.98 0 0 1 0 5.54" strokeWidth="2" fill="none" />
        <Path d="M5.93 17.46a8.97 8.97 0 0 1 0-10.92M18.07 6.54a8.97 8.97 0 0 1 0 10.92" strokeWidth="2" fill="none" />
      </>
    ),
  },
  timeline: {
    outlined: (
      <Path
        d="M3 17h2l3-6 3 4 3-8 3 6h3"
        strokeWidth="1.5"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    ),
    filled: (
      <Path
        d="M3 17h2l3-6 3 4 3-8 3 6h3"
        strokeWidth="2.5"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    ),
  },
  library_music: {
    outlined: (
      <Path
        d="M4 6h2v12H4V6zm4-2h2v16H8V4zm4 4h2v8h-2v-8zm4-2h2v12h-2V6z"
        strokeWidth="0"
      />
    ),
    filled: (
      <Path
        d="M3 5h3v14H3V5zm5-2h3v18H8V3zm5 4h3v10h-3V7zm5-3h3v16h-3V4z"
        strokeWidth="0"
      />
    ),
  },
  blur_on: {
    outlined: (
      <>
        <Circle cx="12" cy="12" r="1.5" />
        <Circle cx="12" cy="6" r="1" />
        <Circle cx="12" cy="18" r="1" />
        <Circle cx="6" cy="12" r="1" />
        <Circle cx="18" cy="12" r="1" />
        <Circle cx="8" cy="8" r="0.75" />
        <Circle cx="16" cy="8" r="0.75" />
        <Circle cx="8" cy="16" r="0.75" />
        <Circle cx="16" cy="16" r="0.75" />
        <Circle cx="12" cy="3" r="0.5" />
        <Circle cx="12" cy="21" r="0.5" />
        <Circle cx="3" cy="12" r="0.5" />
        <Circle cx="21" cy="12" r="0.5" />
      </>
    ),
    filled: (
      <>
        <Circle cx="12" cy="12" r="2" />
        <Circle cx="12" cy="6" r="1.25" />
        <Circle cx="12" cy="18" r="1.25" />
        <Circle cx="6" cy="12" r="1.25" />
        <Circle cx="18" cy="12" r="1.25" />
        <Circle cx="8" cy="8" r="1" />
        <Circle cx="16" cy="8" r="1" />
        <Circle cx="8" cy="16" r="1" />
        <Circle cx="16" cy="16" r="1" />
        <Circle cx="12" cy="3" r="0.75" />
        <Circle cx="12" cy="21" r="0.75" />
        <Circle cx="3" cy="12" r="0.75" />
        <Circle cx="21" cy="12" r="0.75" />
      </>
    ),
  },
};

export function TabIcon({ name, size = 24, color, filled = false }: TabIconProps) {
  const variant = filled ? 'filled' : 'outlined';

  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={color}
      stroke={color}
    >
      {icons[name][variant]}
    </Svg>
  );
}
