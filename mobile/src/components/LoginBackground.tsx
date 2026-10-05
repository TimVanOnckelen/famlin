import React from 'react';
import { StyleSheet } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { colors } from '@/constants/colors';

// The login screen's brand gradient (issue #164) — a soft wash derived from
// the family's color, never a photo (everything before login is public).
// Renders nothing when unbranded (flat `colors.bg`, today's look).
export function LoginBackground() {
  if (colors.loginBgFrom === colors.loginBgTo) return null;
  return (
    <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
      <Defs>
        <LinearGradient id="loginBg" x1="0" y1="0" x2="0.6" y2="1">
          <Stop offset="0" stopColor={colors.loginBgFrom} />
          <Stop offset="1" stopColor={colors.loginBgTo} />
        </LinearGradient>
      </Defs>
      <Rect width="100%" height="100%" fill="url(#loginBg)" />
    </Svg>
  );
}
