import crypto from 'crypto';
import fsp from 'fs/promises';
import path from 'path';
import sharp, { type Metadata } from 'sharp';
import { uploadsDir } from '../../config.js';
import { getAllSettings, updateSettings, type ServerSettings } from '../settings.js';
import { isHexColor, normalizeHex } from './color.js';
import {
  BRAND_PRESETS,
  DEFAULT_PRESET,
  derivePalette,
  type BrandPalette,
  type DerivedBrand,
  type SemanticPalette,
} from './palette.js';

export { BRAND_PRESETS, DEFAULT_PRESET, derivePalette } from './palette.js';

export const CUSTOM_PRESET = 'custom';
// The Setting rows that make up the brand — exported and restored with the
// family's content (services/export.ts, services/import.ts).
export const BRANDING_SETTING_KEYS = ['brandPreset', 'brandColor', 'brandName', 'brandLogo'] as const;
export const BRAND_NAME_MAX_LENGTH = 40;

// Logo renditions live inside uploadsDir so they ride the same persistent
// volume (and the admin export) as every other upload, but they are NOT
// family content: they're served publicly at /branding/* (the login page
// needs them before anyone has a session) and 404'd under /uploads/branding/*
// (see app.ts), and never get an `Upload` row.
export const BRANDING_DIR_NAME = 'branding';
export const brandingDir = path.join(uploadsDir, BRANDING_DIR_NAME);
export const BRANDING_FILE_RE = /^(logo|favicon)-[0-9a-f]{16}\.png$/;

// Raw upload cap — a logo is a small graphic, not a photo.
export const MAX_LOGO_BYTES = 5 * 1024 * 1024;
const MAX_LOGO_INPUT_PIXELS = 4096 * 4096;
const LOGO_SIZE = 512;
const FAVICON_SIZE = 64;
// SVG is deliberately absent: sharp can decode it, but an SVG is a document
// that can carry script, and the logo is served publicly from our origin.
const ALLOWED_LOGO_FORMATS = new Set(['png', 'jpeg', 'webp']);

export class BrandingError extends Error {
  constructor(public readonly key: 'errors.invalidLogo' | 'errors.logoTooLarge') {
    super(key);
  }
}

export interface PublicBranding {
  name: string | null;
  logoUrl: string | null;
  faviconUrl: string | null;
  palette: BrandPalette;
  semantic: SemanticPalette;
  // Cheap change detector for clients that cache the brand (mobile).
  hash: string;
}

export interface ResolvedBrandSettings {
  preset: string;
  color: string | null;
  name: string;
  logo: string;
}

// Unknown or half-configured values fall back to the default preset rather
// than erroring — a bad row must never take the login page down.
export function resolveBrandSettings(
  settings: Partial<Pick<ServerSettings, 'brandPreset' | 'brandColor' | 'brandName' | 'brandLogo'>>
): ResolvedBrandSettings {
  const brandColor = settings.brandColor ?? '';
  const brandName = settings.brandName ?? '';
  const brandLogo = settings.brandLogo ?? '';
  const color = isHexColor(brandColor) ? normalizeHex(brandColor) : null;
  let preset = settings.brandPreset ?? '';
  if (preset === CUSTOM_PRESET) {
    if (!color) preset = DEFAULT_PRESET;
  } else if (!(preset in BRAND_PRESETS)) {
    preset = DEFAULT_PRESET;
  }
  return {
    preset,
    color,
    name: brandName.trim().slice(0, BRAND_NAME_MAX_LENGTH),
    logo: /^[0-9a-f]{16}$/.test(brandLogo) ? brandLogo : '',
  };
}

export function seedFor(preset: string, color: string | null): string {
  return preset === CUSTOM_PRESET && color ? color : BRAND_PRESETS[preset] ?? BRAND_PRESETS[DEFAULT_PRESET];
}

export function logoUrls(logo: string) {
  return logo
    ? { logoUrl: `/branding/logo-${logo}.png`, faviconUrl: `/branding/favicon-${logo}.png` }
    : { logoUrl: null, faviconUrl: null };
}

export function buildPublicBranding(resolved: ResolvedBrandSettings): PublicBranding | null {
  // Nothing set = today's look exactly, and `null` so clients apply nothing.
  if (resolved.preset === DEFAULT_PRESET && !resolved.name && !resolved.logo) return null;

  const derived = derivePalette(seedFor(resolved.preset, resolved.color));
  const body = {
    name: resolved.name || null,
    ...logoUrls(resolved.logo),
    palette: derived.palette,
    semantic: derived.semantic,
  };
  const hash = crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex').slice(0, 16);
  return { ...body, hash };
}

export async function getBranding(): Promise<PublicBranding | null> {
  return buildPublicBranding(resolveBrandSettings(await getAllSettings()));
}

// The display name for "this family" — push/email titles, page titles.
export async function getBrandName(): Promise<string | null> {
  return resolveBrandSettings(await getAllSettings()).name || null;
}

export interface AdminBrandingView {
  preset: string;
  color: string | null;
  name: string;
  logoUrl: string | null;
  faviconUrl: string | null;
  presets: { id: string; color: string }[];
  derived: DerivedBrand;
}

export async function getAdminBranding(): Promise<AdminBrandingView> {
  const resolved = resolveBrandSettings(await getAllSettings());
  return {
    preset: resolved.preset,
    color: resolved.color,
    name: resolved.name,
    ...logoUrls(resolved.logo),
    presets: Object.entries(BRAND_PRESETS).map(([id, color]) => ({ id, color })),
    derived: derivePalette(seedFor(resolved.preset, resolved.color)),
  };
}

export async function saveBrandSettings(input: { preset: string; color?: string | null; name: string }) {
  await updateSettings({
    brandPreset: input.preset,
    // The admin's own input is stored, never the contrast-adjusted value:
    // derivation runs at read time, and the admin sees the adjustment in the
    // preview.
    brandColor: input.color ? normalizeHex(input.color) : '',
    brandName: input.name.trim(),
  });
  return getAdminBranding();
}

async function removeLogoFiles(keep?: string) {
  let entries: string[];
  try {
    entries = await fsp.readdir(brandingDir);
  } catch {
    return;
  }
  await Promise.all(
    entries
      .filter((file) => BRANDING_FILE_RE.test(file) && (!keep || !file.endsWith(`-${keep}.png`)))
      .map((file) => fsp.rm(path.join(brandingDir, file), { force: true }))
  );
}

export async function saveLogo(input: Buffer) {
  if (input.length > MAX_LOGO_BYTES) throw new BrandingError('errors.logoTooLarge');

  let meta: Metadata;
  try {
    meta = await sharp(input, { limitInputPixels: MAX_LOGO_INPUT_PIXELS }).metadata();
  } catch {
    throw new BrandingError('errors.invalidLogo');
  }
  const { format } = meta;
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (!format || !ALLOWED_LOGO_FORMATS.has(format) || !width || !height) {
    throw new BrandingError('errors.invalidLogo');
  }
  if (width * height > MAX_LOGO_INPUT_PIXELS) throw new BrandingError('errors.logoTooLarge');

  // Re-encoding from decoded pixels strips metadata and anything else the
  // original file carried — only pixels reach the public path.
  const image = sharp(input, { limitInputPixels: MAX_LOGO_INPUT_PIXELS }).rotate();
  const logo = await image
    .clone()
    .resize({ width: LOGO_SIZE, height: LOGO_SIZE, fit: 'inside', withoutEnlargement: true })
    .png()
    .toBuffer();
  const favicon = await image
    .clone()
    .resize({ width: FAVICON_SIZE, height: FAVICON_SIZE, fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  // Content-addressed: a new logo is a new URL, so the files can be cached
  // forever (see the /branding/* route) and never go stale on a client.
  const id = crypto.createHash('sha256').update(logo).digest('hex').slice(0, 16);
  await fsp.mkdir(brandingDir, { recursive: true });
  await fsp.writeFile(path.join(brandingDir, `logo-${id}.png`), logo);
  await fsp.writeFile(path.join(brandingDir, `favicon-${id}.png`), favicon);
  await updateSettings({ brandLogo: id });
  await removeLogoFiles(id);
  return getAdminBranding();
}

export async function deleteLogo() {
  await updateSettings({ brandLogo: '' });
  await removeLogoFiles();
  return getAdminBranding();
}
