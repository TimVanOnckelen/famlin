import type { FastifyReply } from 'fastify';
import path from 'path';
import fs from 'fs';
import fsp from 'fs/promises';
import crypto from 'crypto';
import sharp from 'sharp';
import { getLocalMediaSettings } from '../settings.js';
import { MediaProviderError, type MediaProvider, type MediaAssetVariant } from './types.js';

// Serves photos straight from a directory on disk (typically a NAS share
// bind-mounted into the container): every immediate subdirectory of the
// configured root is a linkable "album", and the image files directly inside
// it are the album's assets. No external service, no API — whatever syncs
// photos onto the disk (Syncthing, rsync, a phone upload tool) is the
// "integration".
//
// v1 is deliberately images-only: thumbnails/previews are generated with
// sharp, and video thumbnails would require ffmpeg. Video files are simply
// ignored when listing.

// Web-decodable image types sharp's prebuilt binaries can also read. HEIC is
// deliberately absent — prebuilt libvips ships without the (patent-encumbered)
// HEVC decoder, so a .heic here could be listed but never thumbnailed.
const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif']);

const VARIANT_WIDTHS = { thumbnail: 400, preview: 1440 } as const;

// Resized renditions are cached on the container filesystem (not a volume) —
// losing the cache just means regenerating on demand.
const CACHE_DIR = path.join(process.cwd(), 'media-cache');

function fileExt(name: string): string {
  return path.extname(name).slice(1).toLowerCase();
}

// Album id = the subdirectory's name. It's stored in MediaAlbumLink (never in
// a URL), but it still must never traverse out of the root.
function isSafeAlbumId(albumId: string): boolean {
  return (
    albumId.length > 0 &&
    albumId.length <= 255 &&
    !albumId.startsWith('.') &&
    !albumId.includes('/') &&
    !albumId.includes('\\') &&
    !albumId.includes('\0')
  );
}

// Asset id = base64url of the filename, so arbitrary filenames (spaces,
// unicode) survive the strict [A-Za-z0-9_-] charset asset URLs are validated
// against (see MEDIA_ASSET_PATH_REGEX in src/types.ts). The round-trip
// re-encode check rejects ids that aren't canonical base64url, so two
// different ids can never name the same file.
export function encodeLocalAssetId(fileName: string): string {
  return Buffer.from(fileName, 'utf8').toString('base64url');
}

function decodeLocalAssetId(assetId: string): string | null {
  let fileName: string;
  try {
    fileName = Buffer.from(assetId, 'base64url').toString('utf8');
  } catch {
    return null;
  }
  if (encodeLocalAssetId(fileName) !== assetId) return null;
  if (
    fileName.length === 0 ||
    fileName.startsWith('.') ||
    fileName.includes('/') ||
    fileName.includes('\\') ||
    fileName.includes('\0')
  ) {
    return null;
  }
  return fileName;
}

async function requireRoot(): Promise<string> {
  const { rootPath, configured } = await getLocalMediaSettings();
  if (!configured) throw new MediaProviderError('local', 'not_configured');
  return rootPath;
}

// Resolves an album directory under the root, refusing anything that escapes
// it — defense in depth on top of isSafeAlbumId (which admin linking already
// enforces), since album ids also arrive from the DB.
async function resolveAlbumDir(albumId: string): Promise<string> {
  const root = await requireRoot();
  if (!isSafeAlbumId(albumId)) throw new MediaProviderError('local', 'unreachable');
  const dir = path.resolve(root, albumId);
  if (dir !== path.join(root, albumId) || !dir.startsWith(root + path.sep)) {
    throw new MediaProviderError('local', 'unreachable');
  }
  return dir;
}

async function listImageFiles(albumDir: string): Promise<string[]> {
  const entries = await fsp.readdir(albumDir, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && !e.name.startsWith('.') && IMAGE_EXTENSIONS.has(fileExt(e.name)))
    .map((e) => e.name)
    .sort();
}

const CONTENT_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
};

// Streams a file with single-range support — images don't strictly need it,
// but honoring Range keeps this provider's contract identical to Immich's
// proxy (and ready for video originals later).
async function streamFile(filePath: string, contentType: string, reply: FastifyReply, rangeHeader?: string) {
  const stat = await fsp.stat(filePath);

  reply.header('content-type', contentType);
  reply.header('accept-ranges', 'bytes');

  const match = rangeHeader?.match(/^bytes=(\d*)-(\d*)$/);
  if (match && (match[1] || match[2])) {
    const start = match[1] ? parseInt(match[1], 10) : Math.max(0, stat.size - parseInt(match[2], 10));
    const end = match[1] && match[2] ? Math.min(parseInt(match[2], 10), stat.size - 1) : stat.size - 1;
    if (start > end || start >= stat.size) {
      reply.status(416);
      reply.header('content-range', `bytes */${stat.size}`);
      return reply.send();
    }
    reply.status(206);
    reply.header('content-range', `bytes ${start}-${end}/${stat.size}`);
    reply.header('content-length', String(end - start + 1));
    return reply.send(fs.createReadStream(filePath, { start, end }));
  }

  reply.header('content-length', String(stat.size));
  return reply.send(fs.createReadStream(filePath));
}

// Returns the cached rendition path, (re)generating it when missing or when
// the source file changed since it was cached.
async function ensureRendition(
  albumId: string,
  fileName: string,
  filePath: string,
  variant: 'thumbnail' | 'preview'
): Promise<string> {
  const key = crypto.createHash('sha256').update(`${albumId}/${fileName}`).digest('hex');
  const cachePath = path.join(CACHE_DIR, `${key}-${variant}.jpg`);

  const sourceStat = await fsp.stat(filePath);
  try {
    const cacheStat = await fsp.stat(cachePath);
    if (cacheStat.mtimeMs >= sourceStat.mtimeMs) return cachePath;
  } catch {
    // cache miss
  }

  await fsp.mkdir(CACHE_DIR, { recursive: true });
  const tmpPath = `${cachePath}.${process.pid}.${Date.now()}.tmp`;
  // rotate() applies the EXIF orientation before it's lost with the metadata;
  // fit 'inside' preserves aspect ratio (GIFs render as a first-frame still,
  // which is what a thumbnail should be anyway).
  await sharp(filePath)
    .rotate()
    .resize({ width: VARIANT_WIDTHS[variant], height: VARIANT_WIDTHS[variant], fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toFile(tmpPath);
  // Atomic swap so a concurrent request never reads a half-written file.
  await fsp.rename(tmpPath, cachePath);
  return cachePath;
}

export const localProvider: MediaProvider = {
  id: 'local',

  async isConfigured() {
    return (await getLocalMediaSettings()).configured;
  },

  isValidAlbumId(externalAlbumId: string) {
    return isSafeAlbumId(externalAlbumId);
  },

  async listAlbums() {
    const root = await requireRoot();
    let entries;
    try {
      entries = await fsp.readdir(root, { withFileTypes: true });
    } catch {
      throw new MediaProviderError('local', 'unreachable');
    }
    const dirs = entries.filter((e) => e.isDirectory() && !e.name.startsWith('.'));
    return Promise.all(
      dirs.map(async (dir) => {
        let assetCount = 0;
        try {
          assetCount = (await listImageFiles(path.join(root, dir.name))).length;
        } catch {
          // unreadable subdirectory — list it with 0 rather than failing the catalog
        }
        return { id: dir.name, name: dir.name, assetCount };
      })
    );
  },

  async getAlbumInfo(externalAlbumId: string) {
    const dir = await resolveAlbumDir(externalAlbumId);
    try {
      return { assetCount: (await listImageFiles(dir)).length };
    } catch {
      // Folder deleted/renamed after being linked — mirror Immich's "album
      // gone" contract instead of failing the whole album list.
      return null;
    }
  },

  async listAlbumAssets(externalAlbumId: string) {
    const dir = await resolveAlbumDir(externalAlbumId);
    let files: string[];
    try {
      files = await listImageFiles(dir);
    } catch {
      throw new MediaProviderError('local', 'unreachable');
    }
    return files.map((name) => ({
      id: encodeLocalAssetId(name),
      type: 'IMAGE' as const,
      width: null,
      height: null,
      // thumbnail/preview are always generated JPEGs; original streams the
      // real file, so its URL extension must match the real bytes.
      originalExt: fileExt(name) === 'jpeg' ? 'jpeg' : fileExt(name),
    }));
  },

  async isAssetInAlbum(externalAlbumId: string, assetId: string) {
    const fileName = decodeLocalAssetId(assetId);
    if (!fileName || !IMAGE_EXTENSIONS.has(fileExt(fileName))) return false;
    const dir = await resolveAlbumDir(externalAlbumId);
    try {
      return (await fsp.stat(path.join(dir, fileName))).isFile();
    } catch {
      return false;
    }
  },

  async streamAsset(
    externalAlbumId: string,
    assetId: string,
    variant: MediaAssetVariant,
    reply: FastifyReply,
    rangeHeader?: string
  ) {
    const fileName = decodeLocalAssetId(assetId);
    if (!fileName || !IMAGE_EXTENSIONS.has(fileExt(fileName))) {
      throw new MediaProviderError('local', 'unreachable');
    }
    const dir = await resolveAlbumDir(externalAlbumId);
    const filePath = path.join(dir, fileName);

    try {
      if (variant === 'original') {
        return await streamFile(filePath, CONTENT_TYPES[fileExt(fileName)] ?? 'application/octet-stream', reply, rangeHeader);
      }
      const rendition = await ensureRendition(externalAlbumId, fileName, filePath, variant);
      return await streamFile(rendition, 'image/jpeg', reply, rangeHeader);
    } catch (err) {
      if (err instanceof MediaProviderError) throw err;
      // ENOENT race (file removed between the isAssetInAlbum check and here)
      // or a sharp decode failure — expected-shape failure, not a bug to leak.
      throw new MediaProviderError('local', 'unreachable');
    }
  },
};
