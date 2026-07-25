import React from 'react';
import { Feather } from '@expo/vector-icons';
import { colors } from '@/constants/colors';

// The one icon vocabulary for the app — Feather's flat, minimal, single-weight
// line set, deliberately *not* the platform's native icons (SF Symbols /
// Material), so a Famlin screen looks identical on iOS and Android and matches
// the web app, whose `web/src/components/Icon.tsx` draws the same Feather
// shapes under the same names.
//
// Don't reach for another @expo/vector-icons family (FontAwesome, Ionicons,
// MaterialIcons) for a one-off glyph, and don't use an emoji as an icon: an
// emoji is rendered by the platform's own emoji font, so it changes shape and
// colour per OS and can't take a tint.
//
// The one deliberate exception is reactions (👍❤️😂😮😢🥰, see
// constants/reactions.ts), which stay native platform emoji — a reaction is
// the user's own expressive content, and readers expect it in the emoji font
// they already know rather than as a line drawing.
export type IconName = keyof typeof Feather.glyphMap;

interface IconProps {
  name: IconName;
  size?: number;
  color?: string;
}

export function Icon({ name, size = 24, color = colors.textTitle }: IconProps) {
  return <Feather name={name} size={size} color={color} />;
}
