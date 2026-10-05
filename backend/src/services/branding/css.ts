import { hexToRgbTriplet } from './color.js';
import type { PublicBranding } from './index.js';
import { DEFAULT_SEMANTIC } from './palette.js';

// CSS custom-property overrides for the web app's design tokens
// (web/src/index.css). Mirrors brandingCssVars() in web/src/utils/branding.ts,
// which re-applies the same overrides at runtime — this copy is injected into
// index.html server-side so a branded server never flashes the default teal.
export function brandingCssVars(branding: PublicBranding): Record<string, string> {
  const { palette: p, semantic: s } = branding;
  const vars: Record<string, string> = {
    '--fam-primary': p.primary,
    '--fam-primary-dark': p.primaryDark,
    '--fam-primary-light': p.primaryLight,
    '--fam-primary-tint': p.primaryTint,
    '--fam-primary-rgb': hexToRgbTriplet(p.primary),
    '--fam-grad': `linear-gradient(150deg, ${p.primaryLight}, ${p.primaryDark})`,
    '--fam-bg': p.bg,
    '--fam-login-bg':
      p.loginBgFrom === p.loginBgTo ? p.loginBgFrom : `linear-gradient(160deg, ${p.loginBgFrom}, ${p.loginBgTo})`,
    '--shadow-primary': `0 4px 14px rgba(${hexToRgbTriplet(p.primary)}, 0.32)`,
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
  // Hand-picked extra milestone/accent shades in the web CSS only follow the
  // brand when the server actually shifted that family; otherwise they keep
  // their exact default values.
  if (s.milestone !== DEFAULT_SEMANTIC.milestone) {
    vars['--fam-milestone-bg-strong'] = `color-mix(in oklab, ${s.milestone} 30%, white)`;
    vars['--fam-milestone-light'] = `color-mix(in oklab, ${s.milestone} 40%, white)`;
    vars['--fam-milestone-deep'] = `color-mix(in oklab, ${s.milestone} 75%, black)`;
    vars['--fam-milestone-ink'] = `color-mix(in oklab, ${s.milestoneText} 70%, ${s.milestone})`;
  }
  if (s.circle !== DEFAULT_SEMANTIC.circle) {
    vars['--fam-accent-ink'] = s.circleDark;
  }
  return vars;
}

const escapeAttr = (v: string) =>
  v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Injects the brand into the web SPA's index.html: the token overrides, the
// family name as <title> and the logo's favicon rendition. Values are either
// server-derived hexes or escaped, so nothing admin-typed reaches the page
// unescaped.
export function injectBrandingIntoHtml(html: string, branding: PublicBranding | null): string {
  if (!branding) return html;
  const vars = Object.entries(brandingCssVars(branding))
    .map(([k, v]) => `${k}:${v}`)
    .join(';');
  const head = [
    `<style id="famlin-branding">:root{${vars}}</style>`,
    branding.faviconUrl ? `<link rel="icon" type="image/png" href="${escapeAttr(branding.faviconUrl)}" />` : '',
  ].join('');

  let out = html;
  if (branding.name) {
    out = out.replace(/<title>[^<]*<\/title>/, `<title>${escapeAttr(branding.name)}</title>`);
  }
  return out.replace('</head>', `${head}</head>`);
}
