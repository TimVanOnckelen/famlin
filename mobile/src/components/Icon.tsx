import React from 'react';
import { Feather } from '@expo/vector-icons';
import Svg, { Path } from 'react-native-svg';
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

// Feather is outline-only, so an "on" state drawn as just a tint change
// (e.g. textMuted → primary, two close blue-greys) is near-invisible on a thin
// stroke. For the icons with a meaningful "on" state, `filled` draws the same
// Feather shape as an SVG with its fill set — the same thing web's `Icon`
// `filled` prop does, copied verbatim from feathericons.com.
const FILLABLE_PATHS: Partial<Record<IconName, string>> = {
  bookmark: 'M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z',
};

interface IconProps {
  name: IconName;
  size?: number;
  color?: string;
  /** Only for icons with a meaningful "on" state (a saved bookmark, a pinned story); ignored for others. */
  filled?: boolean;
}

export function Icon({ name, size = 24, color = colors.textTitle, filled = false }: IconProps) {
  // A fillable icon draws both states as SVG, so toggling `filled` keeps the
  // exact same box — the Feather font glyph's line-height differs from `size`,
  // which would make the icon jump on toggle.
  const fillablePath = FILLABLE_PATHS[name];
  if (fillablePath) {
    return (
      <Svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill={filled ? color : 'none'}
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        testID={filled ? `icon-${name}-filled` : `icon-${name}-outline`}
      >
        <Path d={fillablePath} />
      </Svg>
    );
  }
  return <Feather name={name} size={size} color={color} />;
}
