import { describe, it, expect, afterEach } from 'vitest';
import type { Branding } from '@famlin/api-client';
import { applyBranding, brandingCssVars } from '../branding';

const plum: Branding = {
  name: 'The Janssens',
  logoUrl: '/branding/logo-0123456789abcdef.png',
  faviconUrl: '/branding/favicon-0123456789abcdef.png',
  palette: {
    primary: '#7b3f8c',
    primaryDark: '#632874',
    primaryLight: '#955ea5',
    primaryTint: '#f7e8fb',
    bg: '#f9f3fa',
    loginBgFrom: '#f9f3fa',
    loginBgTo: '#f7e8fb',
  },
  semantic: {
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
  },
  hash: 'abc',
};

describe('branding', () => {
  afterEach(() => applyBranding(null, 'Famlin'));

  it('maps the palette onto the design tokens', () => {
    const vars = brandingCssVars(plum);
    expect(vars['--fam-primary']).toBe('#7b3f8c');
    expect(vars['--fam-primary-rgb']).toBe('123, 63, 140');
    expect(vars['--fam-login-bg']).toBe('linear-gradient(160deg, #f9f3fa, #f7e8fb)');
    // Unshifted families keep their hand-picked extra shades.
    expect(vars['--fam-milestone-bg-strong']).toBeUndefined();
    expect(vars['--fam-accent-ink']).toBeUndefined();
  });

  it('derives the extra shades of a shifted family', () => {
    const vars = brandingCssVars({ ...plum, semantic: { ...plum.semantic, milestone: '#7cd590', circle: '#d582ce' } });
    expect(vars['--fam-milestone-bg-strong']).toContain('#7cd590');
    expect(vars['--fam-accent-ink']).toBe('#a8482c');
  });

  it('applies the tokens, title and favicon, and removes them again', () => {
    applyBranding(plum, 'Famlin');
    const root = document.documentElement;
    expect(root.style.getPropertyValue('--fam-primary')).toBe('#7b3f8c');
    expect(document.title).toBe('The Janssens');
    expect(document.querySelector<HTMLLinkElement>('link[rel="icon"]')?.getAttribute('href')).toBe(plum.faviconUrl);

    applyBranding(null, 'Famlin');
    expect(root.style.getPropertyValue('--fam-primary')).toBe('');
    expect(document.title).toBe('Famlin');
    expect(document.querySelector('link[rel="icon"]')).toBeNull();
  });
});
