import React from 'react';
import Svg, { Rect, Polygon, Circle, Path, Defs, LinearGradient, Stop } from 'react-native-svg';

interface LogoProps {
  size?: number;
  color?: string;
}

export function Logo({ size = 48, color }: LogoProps) {
  const fillColor = color || '#D96A5E';

  return (
    <Svg width={size} height={size} viewBox="0 0 48 44">
      <Rect x="5" y="22" width="38" height="22" rx="3.5" fill="white" fillOpacity={0.95} />
      <Polygon points="24,4 46,24 2,24" fill="white" />
      <Rect x="17" y="29" width="14" height="15" rx="2.5" fill={fillColor} />
      <Circle cx="28" cy="37" r="1.3" fill="white" fillOpacity={0.7} />
      <Path
        d="M24 13 C20 13 17 10 17 6 A3.5 3.5 0 0 1 24 6 A3.5 3.5 0 0 1 31 6 C31 10 28 13 24 13Z"
        fill="#F2B85C"
      />
      <Rect x="8" y="26" width="7" height="6" rx="1.2" fill="white" fillOpacity={0.8} />
      <Rect x="33" y="26" width="7" height="6" rx="1.2" fill="white" fillOpacity={0.8} />
    </Svg>
  );
}

export function AppIcon({ size = 200 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 44">
      <Defs>
        <LinearGradient id="iconGradient" x1="0" y1="0" x2="0" y2="44">
          <Stop offset="0" stopColor="#E07A6B" />
          <Stop offset="1" stopColor="#C95D4E" />
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width="48" height="44" rx="6" fill="url(#iconGradient)" />
      <Rect x="5" y="22" width="38" height="22" rx="3.5" fill="white" fillOpacity={0.95} />
      <Polygon points="24,4 46,24 2,24" fill="white" />
      <Rect x="17" y="29" width="14" height="15" rx="2.5" fill="#C95D4E" />
      <Circle cx="28" cy="37" r="1.3" fill="white" fillOpacity={0.7} />
      <Path
        d="M24 13 C20 13 17 10 17 6 A3.5 3.5 0 0 1 24 6 A3.5 3.5 0 0 1 31 6 C31 10 28 13 24 13Z"
        fill="#F2B85C"
      />
      <Rect x="8" y="26" width="7" height="6" rx="1.2" fill="white" fillOpacity={0.8} />
      <Rect x="33" y="26" width="7" height="6" rx="1.2" fill="white" fillOpacity={0.8} />
    </Svg>
  );
}
