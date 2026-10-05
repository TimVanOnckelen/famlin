import React from 'react';
import { Image } from 'react-native';
import Svg, { Path, Circle, Rect, Defs, LinearGradient, Stop, G } from 'react-native-svg';
import { getBrandingAssetUrl } from '@famlin/api-client';
import { colors } from '@/constants/colors';
import { getBranding, getBrandingServerUrl } from '@/branding';

interface LogoProps {
  size?: number;
}

const HOUSE_PATH =
  'M24 6 Q25.6 6 26.9 6.95 L40.4 17.4 Q42 18.65 42 20.7 L42 38 Q42 42 38 42 L10 42 Q6 42 6 38 L6 20.7 Q6 18.65 7.6 17.4 L21.1 6.95 Q22.4 6 24 6 Z';
const DOOR_PATH = 'M18.5 42 L18.5 31 Q18.5 26 24 26 Q29.5 26 29.5 31 L29.5 42 Z';

export function Logo({ size = 48 }: LogoProps) {
  const radius = size * 0.22;
  const markSize = size * 0.7;
  const offset = (size - markSize) / 2;
  const scale = markSize / 48;
  const gradientId = `famlinLogoGradient-${size}`;

  return (
    <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <Defs>
        <LinearGradient id={gradientId} x1="0%" y1="0%" x2="85%" y2="100%">
          <Stop offset="0" stopColor={colors.primaryLight} />
          <Stop offset="1" stopColor={colors.primaryDark} />
        </LinearGradient>
      </Defs>
      <Rect width={size} height={size} rx={radius} fill={`url(#${gradientId})`} />
      <G transform={`translate(${offset}, ${offset}) scale(${scale})`}>
        <Path d={HOUSE_PATH} fill="white" />
        <Circle cx="24" cy="20.5" r="2.6" fill={colors.primary} />
        <Path d={DOOR_PATH} fill={colors.primary} />
      </G>
    </Svg>
  );
}

export function AppIcon({ size = 200 }: LogoProps) {
  return <Logo size={size} />;
}

// The family's own logo when branding sets one (issue #164), else the Famlin
// house mark in the brand's colors. Same footprint either way. The product
// itself (profile's "App" section) keeps using <Logo /> directly.
export function BrandLogo({ size = 48 }: LogoProps) {
  const branding = getBranding();
  if (!branding?.logoUrl) return <Logo size={size} />;
  return (
    <Image
      source={{ uri: getBrandingAssetUrl(branding.logoUrl, getBrandingServerUrl() ?? undefined) }}
      style={{ width: size, height: size, borderRadius: size * 0.22 }}
      resizeMode="contain"
      accessibilityIgnoresInvertColors
    />
  );
}
