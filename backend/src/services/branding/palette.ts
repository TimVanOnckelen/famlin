import { contrastRatio, hexToOklch, hueDistance, normalizeHex, oklchToHex, type Oklch } from './color.js';

// Per-family branding palette derivation (issue #164). This is the ONE
// implementation both clients consume — mobile and web never derive colors
// themselves, they apply what GET /api/auth/server-info hands them — so the
// two can't drift apart.
//
// Input: a seed hex (a preset's, or the admin's custom one). Output: the
// primary family of tokens plus the semantic post-type colors (circle,
// milestone, trip), which are shifted to an alternate hue when the brand
// would otherwise make them indistinguishable from an ordinary family post.

// Today's look, verbatim — mirrors mobile/src/constants/colors.ts and
// web/src/index.css. The `teal` preset returns exactly these, untouched by
// derivation or the collision shift, so an unbranded server (and a server
// that only sets a name or logo) stays pixel-identical on upgrade. Teal sits
// 2° from the trip blue in hue; it predates branding and coexists with it by
// design, which is why it's exempt rather than shifted.
export const DEFAULT_PALETTE = {
  primary: '#006e94',
  primaryDark: '#005480',
  primaryLight: '#318ea2',
  primaryTint: '#daf3fe',
  bg: '#edf7fb',
  loginBgFrom: '#edf7fb',
  loginBgTo: '#edf7fb',
};

export const DEFAULT_SEMANTIC = {
  accent: '#ed835e',
  updateBg: '#fbe2d4',
  circle: '#ed835e',
  circleDark: '#a8482c',
  circleTint: '#fdeae2',
  milestone: '#eeb154',
  milestoneBg: '#fff3dd',
  milestoneText: '#5c3d0a',
  milestoneDivider: '#eccf94',
  trip: '#1f7fa3',
  tripDark: '#1a6484',
  tripBg: '#eef7fb',
  tripTint: '#dcf0f7',
  tripBorder: '#bfe1ec',
};

export type BrandPalette = typeof DEFAULT_PALETTE;
export type SemanticPalette = typeof DEFAULT_SEMANTIC;
export type SemanticFamily = 'circle' | 'milestone' | 'trip';

export const DEFAULT_PRESET = 'teal';

// Curated seeds. A preset is nothing more than a seed hex run through the
// same derivation a custom color gets (except teal, see DEFAULT_PALETTE).
// Ids are persisted in the Setting table — never rename one.
export const BRAND_PRESETS: Record<string, string> = {
  teal: '#006e94',
  ocean: '#2459b8',
  indigo: '#4b4fb0',
  plum: '#7b3f8c',
  rose: '#b83f67',
  coral: '#c2532d',
  amber: '#9a6412',
  forest: '#2f7a4b',
  slate: '#4a5d70',
};

// Each semantic family is a set of tokens that move together, and the hue it
// moves to when the brand collides with it. The alternate keeps every
// token's lightness and chroma and only swaps the hue, so the family's
// internal contrast (badge vs. tint vs. text) is preserved. The alternates
// are chosen ≥ 70° away from every original family hue, so shifting one
// can't land on another family — or back on the brand that triggered it.
const SEMANTIC_FAMILIES: Record<SemanticFamily, { hue: number; altHue: number; tokens: (keyof SemanticPalette)[] }> = {
  // accent and updateBg are the same warm coral as circle today and track it:
  // a coral brand moves all three together, so none of them clash with it.
  circle: { hue: hexToOklch(DEFAULT_SEMANTIC.circle).h, altHue: 330, tokens: ['accent', 'updateBg', 'circle', 'circleDark', 'circleTint'] },
  milestone: { hue: hexToOklch(DEFAULT_SEMANTIC.milestone).h, altHue: 150, tokens: ['milestone', 'milestoneBg', 'milestoneText', 'milestoneDivider'] },
  trip: { hue: hexToOklch(DEFAULT_SEMANTIC.trip).h, altHue: 295, tokens: ['trip', 'tripDark', 'tripBg', 'tripTint', 'tripBorder'] },
};

// A brand hue within this many degrees (OKLCH) of a family's hue collides.
// Coral and gold are only ~35° apart, so a brand between them shifts both.
export const COLLISION_HUE_DISTANCE = 25;
// Below this chroma a brand reads as gray and has no hue to collide with.
export const COLLISION_MIN_CHROMA = 0.04;
// WCAG AA for normal text: white button labels on `primary`.
export const MIN_CONTRAST = 4.5;

export interface DerivedBrand {
  seed: string;
  palette: BrandPalette;
  semantic: SemanticPalette;
  // True when `primary` had to be darkened from the seed to reach AA.
  adjusted: boolean;
  shifted: SemanticFamily[];
}

// Darkens (lowers OKLCH lightness) until white text on it passes AA.
function ensureContrast(seed: Oklch): Oklch {
  let color = { ...seed };
  while (contrastRatio('#ffffff', oklchToHex(color)) < MIN_CONTRAST && color.l > 0) {
    color = { ...color, l: Math.max(0, color.l - 0.005) };
  }
  return color;
}

export function collidingFamilies(seedHex: string): SemanticFamily[] {
  const { c, h } = hexToOklch(seedHex);
  if (c < COLLISION_MIN_CHROMA) return [];
  return (Object.keys(SEMANTIC_FAMILIES) as SemanticFamily[]).filter(
    (family) => hueDistance(h, SEMANTIC_FAMILIES[family].hue) < COLLISION_HUE_DISTANCE
  );
}

function shiftSemantic(families: SemanticFamily[]): SemanticPalette {
  const semantic = { ...DEFAULT_SEMANTIC };
  for (const family of families) {
    const { altHue, tokens } = SEMANTIC_FAMILIES[family];
    for (const token of tokens) {
      const original = hexToOklch(DEFAULT_SEMANTIC[token]);
      semantic[token] = oklchToHex({ l: original.l, c: original.c, h: altHue });
    }
  }
  return semantic;
}

export function derivePalette(seedHex: string): DerivedBrand {
  const seed = normalizeHex(seedHex);
  if (seed === BRAND_PRESETS[DEFAULT_PRESET]) {
    return {
      seed,
      palette: { ...DEFAULT_PALETTE },
      semantic: { ...DEFAULT_SEMANTIC },
      adjusted: false,
      shifted: [],
    };
  }

  const p = ensureContrast(hexToOklch(seed));
  const primary = oklchToHex(p);
  // Offsets measured from the teal defaults (DEFAULT_PALETTE) in OKLCH, so a
  // derived palette has the same relationships the hand-picked one does.
  const primaryTint = oklchToHex({ l: 0.949, c: Math.min(0.03, p.c * 0.3), h: p.h });
  const bg = oklchToHex({ l: 0.97, c: Math.min(0.012, p.c * 0.12), h: p.h });
  const shifted = collidingFamilies(primary);

  return {
    seed,
    palette: {
      primary,
      primaryDark: oklchToHex({ l: Math.max(0.12, p.l - 0.08), c: p.c, h: p.h }),
      primaryLight: oklchToHex({ l: Math.min(0.75, p.l + 0.095), c: p.c * 0.9, h: p.h }),
      primaryTint,
      bg,
      // Login background: a soft wash from the page background into the
      // brand tint. Never a photo — everything before login is public.
      loginBgFrom: bg,
      loginBgTo: primaryTint,
    },
    semantic: shiftSemantic(shifted),
    adjusted: primary !== seed,
    shifted,
  };
}
