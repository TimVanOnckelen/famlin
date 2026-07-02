import { prisma } from '../db.js';
import { DEFAULT_LANGUAGE, SUPPORTED_LANGUAGES, SupportedLanguage } from '../i18n/index.js';

export interface ServerSettings {
  defaultLanguage: SupportedLanguage;
  appStoreUrl: string;
  playStoreUrl: string;
  allowedEmails: string[];
  oidcName: string;
  oidcIssuer: string;
  oidcClientId: string;
  oidcScopes: string;
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPass: string;
  smtpFrom: string;
  pushNotificationsEnabled: boolean;
  emailNotificationsEnabled: boolean;
}

const SETTING_KEYS: (keyof ServerSettings)[] = [
  'defaultLanguage',
  'appStoreUrl',
  'playStoreUrl',
  'allowedEmails',
  'oidcName',
  'oidcIssuer',
  'oidcClientId',
  'oidcScopes',
  'smtpHost',
  'smtpPort',
  'smtpUser',
  'smtpPass',
  'smtpFrom',
  'pushNotificationsEnabled',
  'emailNotificationsEnabled',
];

function serializeValue(key: keyof ServerSettings, value: any): string {
  if (key === 'allowedEmails') {
    // Normalize casing on write so a later case-sensitive comparison in
    // isEmailAllowed() can't miss an entry the admin typed with different
    // capitalization than the OIDC/login email arrives in.
    return Array.isArray(value) ? value.map((v) => String(v).toLowerCase().trim()).join(',') : String(value);
  }
  return String(value ?? '');
}

function parseValue(key: keyof ServerSettings, value: string): any {
  if (key === 'allowedEmails') {
    return value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  if (key === 'smtpPort') {
    const n = parseInt(value, 10);
    return isNaN(n) ? 587 : n;
  }
  if (key === 'pushNotificationsEnabled' || key === 'emailNotificationsEnabled') {
    return value !== 'false';
  }
  if (key === 'defaultLanguage') {
    return SUPPORTED_LANGUAGES.includes(value as SupportedLanguage) ? value : DEFAULT_LANGUAGE;
  }
  return value;
}

// Settings are read on nearly every request (auth, notifications, i18n
// fallback, invite pages, ...) but change rarely — cache briefly so a burst
// of activity doesn't turn into a `Setting` table read per request. Cleared
// eagerly by updateSettings() so admin changes still take effect immediately.
let settingsCache: { value: ServerSettings; expiresAt: number } | null = null;
const SETTINGS_CACHE_TTL_MS = 10_000;

async function loadAllSettings(): Promise<ServerSettings> {
  const rows = await prisma.setting.findMany();
  const map = new Map(rows.map((r) => [r.key, r.value]));

  return {
    defaultLanguage: parseValue('defaultLanguage', map.get('defaultLanguage') || DEFAULT_LANGUAGE),
    appStoreUrl: parseValue('appStoreUrl', map.get('appStoreUrl') || ''),
    playStoreUrl: parseValue('playStoreUrl', map.get('playStoreUrl') || ''),
    allowedEmails: parseValue('allowedEmails', map.get('allowedEmails') || ''),
    oidcName: parseValue('oidcName', map.get('oidcName') || 'SSO'),
    oidcIssuer: parseValue('oidcIssuer', map.get('oidcIssuer') || ''),
    oidcClientId: parseValue('oidcClientId', map.get('oidcClientId') || ''),
    oidcScopes: parseValue('oidcScopes', map.get('oidcScopes') || 'openid email profile'),
    smtpHost: parseValue('smtpHost', map.get('smtpHost') || ''),
    smtpPort: parseValue('smtpPort', map.get('smtpPort') || '587'),
    smtpUser: parseValue('smtpUser', map.get('smtpUser') || ''),
    smtpPass: parseValue('smtpPass', map.get('smtpPass') || ''),
    smtpFrom: parseValue('smtpFrom', map.get('smtpFrom') || ''),
    pushNotificationsEnabled: parseValue(
      'pushNotificationsEnabled',
      map.get('pushNotificationsEnabled') ?? 'true'
    ),
    emailNotificationsEnabled: parseValue(
      'emailNotificationsEnabled',
      map.get('emailNotificationsEnabled') ?? 'true'
    ),
  };
}

export async function getAllSettings(): Promise<ServerSettings> {
  if (settingsCache && settingsCache.expiresAt > Date.now()) {
    return settingsCache.value;
  }

  const value = await loadAllSettings();
  settingsCache = { value, expiresAt: Date.now() + SETTINGS_CACHE_TTL_MS };
  return value;
}

export async function updateSettings(partial: Partial<ServerSettings>) {
  const entries = Object.entries(partial).filter(([key]) =>
    SETTING_KEYS.includes(key as keyof ServerSettings)
  );

  for (const [key, value] of entries) {
    const serialized = serializeValue(key as keyof ServerSettings, value);
    await prisma.setting.upsert({
      where: { key },
      update: { value: serialized },
      create: { key, value: serialized },
    });
  }

  settingsCache = null;
  return getAllSettings();
}

// Test-only escape hatch: the cache above is keyed purely on wall-clock time,
// so a test that truncates the Setting table directly (bypassing
// updateSettings()) would otherwise keep serving a previous test's cached
// values for up to SETTINGS_CACHE_TTL_MS.
export function __resetSettingsCacheForTests() {
  settingsCache = null;
}

export async function getSetting<K extends keyof ServerSettings>(key: K): Promise<ServerSettings[K]> {
  const settings = await getAllSettings();
  return settings[key];
}

export async function isEmailAllowed(email: string): Promise<boolean> {
  const allowed = await getSetting('allowedEmails');
  if (allowed.length === 0) return true;
  return allowed.includes(email.toLowerCase().trim());
}

export interface OidcSettings {
  name: string;
  issuer: string;
  clientId: string;
  scopes: string;
}

export async function getOidcSettings(): Promise<OidcSettings> {
  const settings = await getAllSettings();
  return {
    name: settings.oidcName,
    issuer: settings.oidcIssuer.trim().replace(/\/$/, ''),
    clientId: settings.oidcClientId.trim(),
    scopes: settings.oidcScopes,
  };
}
