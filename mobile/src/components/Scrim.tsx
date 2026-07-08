import React from 'react';
import { StyleSheet } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

// Bottom-of-photo scrim from the styleguide's "text over photo" pattern:
// transparent fading to rgba(20,10,5,0.72) so white text reads on any photo.
export function Scrim() {
  return (
    <Svg style={StyleSheet.absoluteFill} viewBox="0 0 1 1" preserveAspectRatio="none">
      <Defs>
        <LinearGradient id="scrim" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#140a05" stopOpacity="0" />
          <Stop offset="1" stopColor="#140a05" stopOpacity="0.72" />
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width="1" height="1" fill="url(#scrim)" />
    </Svg>
  );
}
