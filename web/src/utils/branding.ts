import type { Branding } from '@famlin/api-client';

// The default teal's milestone/circle hues — the extra milestone/accent
// tokens below only follow the brand when the server shifted that family,
// so an unshifted family keeps its hand-picked values exactly.
const DEFAULT_MILESTONE = '#eeb154';
const DEFAULT_CIRCLE = '#ed835e';

function rgbTriplet(hex: string): string {
  const n = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16)).join(', ');
}

// CSS custom-property overrides for the design tokens in index.css. MUST
// mirror brandingCssVars() in backend/src/services/branding/css.ts, which
// injects the same overrides into index.html server-side (so a branded page
// never flashes the default teal); this copy re-applies them at runtime.
export function brandingCssVars(branding: Branding): Record<string, string> {
  const { palette: p, semantic: s } = branding;
  const vars: Record<string, string> = {
    '--fam-primary': p.primary,
    '--fam-primary-dark': p.primaryDark,
    '--fam-primary-light': p.primaryLight,
    '--fam-primary-tint': p.primaryTint,
    '--fam-primary-rgb': rgbTriplet(p.primary),
    '--fam-grad': `linear-gradient(150deg, ${p.primaryLight}, ${p.primaryDark})`,
    '--fam-bg': p.bg,
    '--fam-login-bg':
      p.loginBgFrom === p.loginBgTo ? p.loginBgFrom : `linear-gradient(160deg, ${p.loginBgFrom}, ${p.loginBgTo})`,
    '--shadow-primary': `0 4px 14px rgba(${rgbTriplet(p.primary)}, 0.32)`,
    '--fam-accent': s.accent,
    '--fam-update-bg': s.updateBg,
    '--fam-milestone': s.milestone,
    '--fam-milestone-bg': s.milestoneBg,
    '--fam-milestone-text': s.milestoneText,
    '--fam-milestone-divider': s.milestoneDivider,
    '--fam-trip': s.trip,
    '--fam-trip-dark': s.tripDark,
    '--fam-trip-bg': s.tripBg,
    '--fam-trip-tint': s.tripTint,
    '--fam-trip-border': s.tripBorder,
    '--fam-circle': s.circle,
    '--fam-circle-dark': s.circleDark,
    '--fam-circle-tint': s.circleTint,
  };
  if (s.milestone !== DEFAULT_MILESTONE) {
    vars['--fam-milestone-bg-strong'] = `color-mix(in oklab, ${s.milestone} 30%, white)`;
    vars['--fam-milestone-light'] = `color-mix(in oklab, ${s.milestone} 40%, white)`;
    vars['--fam-milestone-deep'] = `color-mix(in oklab, ${s.milestone} 75%, black)`;
    vars['--fam-milestone-ink'] = `color-mix(in oklab, ${s.milestoneText} 70%, ${s.milestone})`;
  }
  if (s.circle !== DEFAULT_CIRCLE) {
    vars['--fam-accent-ink'] = s.circleDark;
  }
  return vars;
}

function setFavicon(href: string | null) {
  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!href) {
    link?.remove();
    return;
  }
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    link.type = 'image/png';
    document.head.appendChild(link);
  }
  link.href = href;
}

let applied: string[] = [];

// Applies (or, for null, removes) the family's branding on the live page:
// token overrides, <title> and favicon. Idempotent; safe to call on every
// /server-info refresh.
export function applyBranding(branding: Branding | null | undefined, defaultTitle: string) {
  const root = document.documentElement;
  for (const name of applied) root.style.removeProperty(name);
  applied = [];

  if (branding) {
    for (const [name, value] of Object.entries(brandingCssVars(branding))) {
      root.style.setProperty(name, value);
      applied.push(name);
    }
  }
  // The server already injected these into index.html; a stale injected
  // override (brand removed since the page loaded) must not linger either.
  if (!branding) document.getElementById('famlin-branding')?.remove();
  document.title = branding?.name ?? defaultTitle;
  setFavicon(branding?.faviconUrl ?? null);
}
