import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import type { Branding } from '@famlin/api-client';
import { colors, DEFAULT_COLORS } from '@/constants/colors';

const mockFetchServerInfo = jest.fn();
jest.mock('@famlin/api-client', () => ({
  ...jest.requireActual('@famlin/api-client'),
  fetchServerInfo: () => mockFetchServerInfo(),
}));

// eslint-disable-next-line import/first
import {
  __resetBrandingForTests,
  applyBrandingToColors,
  getBranding,
  loadCachedBranding,
  markScreensLoaded,
  mixHex,
  prepareBrandingForMainScreens,
} from '@/branding';

const SERVER = 'https://family.example.com';

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
  hash: 'h1',
};

beforeEach(async () => {
  __resetBrandingForTests();
  mockFetchServerInfo.mockReset();
  await AsyncStorage.clear();
  (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(null);
});

describe('mobile branding', () => {
  it('applies the palette in place and restores the defaults for null', () => {
    applyBrandingToColors(plum);
    expect(colors.primary).toBe('#7b3f8c');
    expect(colors.loginBgTo).toBe('#f7e8fb');
    // Unshifted warm family: the hand-picked update chip shades stay.
    expect(colors.updateText).toBe(DEFAULT_COLORS.updateText);
    applyBrandingToColors(null);
    expect({ ...colors }).toEqual({ ...DEFAULT_COLORS });
  });

  it('follows a shifted warm family for the extra update shades', () => {
    applyBrandingToColors({ ...plum, semantic: { ...plum.semantic, accent: '#d582ce', circleDark: '#8a2f80' } });
    expect(colors.updateText).toBe('#8a2f80');
  });

  it('mixes hexes', () => {
    expect(mixHex('#000000', '#ffffff', 0.5)).toBe('#808080');
  });

  it('applies the cached brand at cold start only for the remembered server', async () => {
    await AsyncStorage.setItem('famlin_branding', JSON.stringify({ serverUrl: SERVER, branding: plum }));

    await loadCachedBranding();
    expect(colors.primary).toBe(DEFAULT_COLORS.primary); // no remembered server (logged out)

    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(`${SERVER}/`);
    await loadCachedBranding();
    expect(colors.primary).toBe('#7b3f8c');
    expect(getBranding()?.name).toBe('The Janssens');
  });

  it('first connect: waits for /server-info and applies it before the main screens load', async () => {
    mockFetchServerInfo.mockResolvedValue({ version: '1', branding: plum });
    await prepareBrandingForMainScreens(SERVER);
    expect(colors.primary).toBe('#7b3f8c');
    expect(JSON.parse((await AsyncStorage.getItem('famlin_branding'))!).branding.hash).toBe('h1');
  });

  it('with a cached brand: refreshes the cache in the background, never re-themes', async () => {
    await AsyncStorage.setItem('famlin_branding', JSON.stringify({ serverUrl: SERVER, branding: plum }));
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(SERVER);
    await loadCachedBranding();

    const forest = { ...plum, palette: { ...plum.palette, primary: '#2f7a4b' }, hash: 'h2' };
    mockFetchServerInfo.mockResolvedValue({ version: '1', branding: forest });
    await prepareBrandingForMainScreens(SERVER);
    markScreensLoaded();
    await new Promise((r) => setTimeout(r, 0));

    expect(colors.primary).toBe('#7b3f8c'); // this session keeps its look
    expect(JSON.parse((await AsyncStorage.getItem('famlin_branding'))!).branding.hash).toBe('h2'); // next cold start
  });

  it('fail-soft: an unreachable server keeps the default', async () => {
    mockFetchServerInfo.mockRejectedValue(new Error('offline'));
    await prepareBrandingForMainScreens(SERVER);
    expect(colors.primary).toBe(DEFAULT_COLORS.primary);
  });
});
