// Per-family branding (issue #164): these values are OVERWRITTEN IN PLACE by
// applyBrandingToColors() (src/branding/) before any screen module is
// required — see BrandedRoot and AuthenticatedScreens. That's why this is a
// mutable object read at StyleSheet.create() time rather than a hook: every
// module that builds styles from it must be loaded after the brand is
// applied, and anything that captured it earlier keeps the default until the
// next cold start. Don't hardcode a brand/semantic hex elsewhere — add a
// token here so it follows the brand.
export const colors = {
  primary: '#006e94',
  primaryDark: '#005480',
  primaryLight: '#318ea2',
  primaryTint: '#daf3fe',
  // Border on a primary-tinted surface (the poll/album type chips).
  primaryBorder: '#a9dced',
  accent: '#ed835e',
  updateBg: '#fbe2d4',
  updateBorder: '#f0c3ac',
  updateText: '#8a3f22',
  milestone: '#eeb154',
  milestoneBg: '#fff3dd',
  milestoneText: '#5c3d0a',
  milestoneDivider: '#eccf94',
  // TRIP post type accent (design's oklch(55% 0.13 220) badge/gradient blue).
  trip: '#1f7fa3',
  tripDark: '#1a6484',
  tripBg: '#eef7fb',
  tripTint: '#dcf0f7',
  tripBorder: '#bfe1ec',
  // Family Circles. Deliberately the warm accent family rather than the
  // primary blues: a circle badge has to read as "narrower than usual" at a
  // glance, so it must not look like the neutral family chip. Mirrors
  // --fam-circle-* in web/src/index.css.
  circle: '#ed835e',
  circleDark: '#a8482c',
  circleTint: '#fdeae2',
  bg: '#edf7fb',
  // Login screen background: a gradient between these (equal = flat bg).
  loginBgFrom: '#edf7fb',
  loginBgTo: '#edf7fb',
  surface: '#ffffff',
  border: '#d9e3e7',
  textMuted: '#597784',
  textBody: '#233036',
  textTitle: '#0f222a',
  // Destructive actions (account deletion) — same token the admin UI uses
  // (--danger in backend/admin/src/index.css).
  danger: '#E05A4C',
  dangerBg: '#fdecea',
  white: '#FFFFFF',
};

// Today's look, untouched — what an unbranded server (or a reset) restores.
export const DEFAULT_COLORS: Readonly<typeof colors> = Object.freeze({ ...colors });
