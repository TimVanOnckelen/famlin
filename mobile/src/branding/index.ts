import AsyncStorage from '@react-native-async-storage/async-storage';
import { fetchServerInfo, type Branding } from '@famlin/api-client';
import { colors, DEFAULT_COLORS } from '@/constants/colors';
import { getServerUrl } from '@/utils/storage';

// Per-family branding (issue #164) on mobile. The app's styles are built
// from the mutable `colors` object at module load (StyleSheet.create), so a
// brand can only apply BEFORE a screen module is first required — never
// live. Three moments:
//
//  - Cold start: BrandedRoot applies the cached brand for the remembered
//    server before it requires App (which in turn loads every screen), then
//    refreshes the cache in the background for the NEXT cold start — no
//    added startup latency and the app never re-themes mid-use.
//  - First connect: the authenticated screens are required lazily
//    (AuthenticatedScreens), so after login App awaits one /server-info
//    fetch and applies the brand before rendering them.
//  - Offline: the cached brand (or the default) is used as-is.
//
// No `expo-updates`/reload: switching to a different server after logout in
// the same process picks up its brand on the next cold start.

const CACHE_KEY = 'famlin_branding';
// How long first-connect waits for /server-info before rendering the default.
const CONNECT_TIMEOUT_MS = 3000;

interface CachedBranding {
  serverUrl: string;
  branding: Branding | null;
}

let current: Branding | null = null;
let currentServerUrl: string | null = null;
let screensLoaded = false;
let hasCacheForServer = false;

const normalize = (url: string) => url.trim().replace(/\/+$/, '');

const MIXABLE = /^#[0-9a-f]{6}$/i;

// Linear sRGB-space blend of two hexes, for the few tokens the server
// palette doesn't carry. `t` = share of `b`.
export function mixHex(a: string, b: string, t: number): string {
  if (!MIXABLE.test(a) || !MIXABLE.test(b)) return a;
  const channel = (hex: string, i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
  return (
    '#' +
    [0, 1, 2]
      .map((i) => Math.round(channel(a, i) * (1 - t) + channel(b, i) * t).toString(16).padStart(2, '0'))
      .join('')
  );
}

// Overwrites `colors` in place with the brand's palette, or restores the
// defaults for `null`.
export function applyBrandingToColors(branding: Branding | null) {
  Object.assign(colors, DEFAULT_COLORS);
  current = branding;
  if (!branding) return;

  const { palette: p, semantic: s } = branding;
  Object.assign(colors, {
    primary: p.primary,
    primaryDark: p.primaryDark,
    primaryLight: p.primaryLight,
    primaryTint: p.primaryTint,
    primaryBorder: mixHex(p.primaryTint, p.primaryLight, 0.35),
    bg: p.bg,
    loginBgFrom: p.loginBgFrom,
    loginBgTo: p.loginBgTo,
    accent: s.accent,
    updateBg: s.updateBg,
    circle: s.circle,
    circleDark: s.circleDark,
    circleTint: s.circleTint,
    milestone: s.milestone,
    milestoneBg: s.milestoneBg,
    milestoneText: s.milestoneText,
    milestoneDivider: s.milestoneDivider,
    trip: s.trip,
    tripDark: s.tripDark,
    tripBg: s.tripBg,
    tripTint: s.tripTint,
    tripBorder: s.tripBorder,
  });
  // The hand-picked update-chip shades only follow the brand when the
  // server shifted the warm family away from its default.
  if (s.accent !== DEFAULT_COLORS.accent) {
    colors.updateBorder = mixHex(s.updateBg, s.accent, 0.35);
    colors.updateText = s.circleDark;
  }
}

async function readCache(): Promise<CachedBranding | null> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as CachedBranding) : null;
  } catch {
    return null;
  }
}

async function writeCache(entry: CachedBranding) {
  try {
    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(entry));
  } catch {
    // A failed write only means the next cold start uses the older brand.
  }
}

// Cold start, before any screen module is required (BrandedRoot). Applies
// the cached brand only when it belongs to the remembered server — after a
// logout (server forgotten) the app starts in the default look.
export async function loadCachedBranding() {
  try {
    const [cache, serverUrl] = await Promise.all([readCache(), getServerUrl()]);
    if (cache && serverUrl && normalize(cache.serverUrl) === normalize(serverUrl)) {
      hasCacheForServer = true;
      currentServerUrl = normalize(serverUrl);
      applyBrandingToColors(cache.branding);
    }
  } catch {
    // Fail-soft: the default look.
  }
}

// Called once, when the authenticated screen modules are first evaluated:
// from then on a brand can only take effect on the next cold start.
export function markScreensLoaded() {
  screensLoaded = true;
}

export function areScreensLoaded() {
  return screensLoaded;
}

// Fetches the brand for `serverUrl` (the API base URL must already point at
// it), caches it for the next cold start, and — while no branded screen has
// been loaded yet — applies it right away. Never throws.
export async function refreshBranding(serverUrl: string): Promise<void> {
  try {
    const info = await fetchServerInfo();
    const branding = info.branding ?? null;
    const url = normalize(serverUrl);
    await writeCache({ serverUrl: url, branding });
    hasCacheForServer = true;
    if (!screensLoaded) {
      currentServerUrl = url;
      applyBrandingToColors(branding);
    }
  } catch {
    // Unreachable server: keep the cache / default.
  }
}

// Before rendering the authenticated screens: on a first connect (no cached
// brand for this server) wait — bounded — for the brand so the main screens
// are built with it; otherwise refresh in the background for next time.
export async function prepareBrandingForMainScreens(serverUrl: string): Promise<void> {
  if (screensLoaded) return;
  if (hasCacheForServer && currentServerUrl === normalize(serverUrl)) {
    void refreshBranding(serverUrl);
    return;
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    refreshBranding(serverUrl),
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, CONNECT_TIMEOUT_MS);
    }),
  ]);
  clearTimeout(timer);
}

// The brand applied in this process (name/logo for the header and login).
export function getBranding(): Branding | null {
  return current;
}

export function getBrandingServerUrl(): string | null {
  return currentServerUrl;
}

// Test-only.
export function __resetBrandingForTests() {
  applyBrandingToColors(null);
  currentServerUrl = null;
  screensLoaded = false;
  hasCacheForServer = false;
}
