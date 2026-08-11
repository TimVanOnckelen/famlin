import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

import type { UploadFile } from '@/api/uploads';

/** Longest edge we send to the server. Deliberately above the backend's
 * 1920px display copy (services/uploadVariants.ts), so nothing the app ever
 * renders loses detail — only the archived `uploads/originals/` copy is now
 * the client-downscaled one rather than the true camera original. */
const MAX_UPLOAD_DIMENSION = 2048;

/** JPEG quality for the re-encode. 0.8 is visually indistinguishable at
 * these dimensions and roughly halves the bytes again after the resize. */
const UPLOAD_JPEG_QUALITY = 0.8;

/** An already-small image is still worth re-encoding if the file itself is
 * large — a 12MP HEIC that happens to be under the dimension cap is still
 * multiple megabytes. */
const RE_ENCODE_FILE_SIZE_BYTES = 1_500_000;

/** Animated GIFs must never go through the manipulator: it would flatten
 * them to a first frame, the same reason the backend excludes .gif from its
 * own resize pipeline (services/uploadVariants.ts). */
function isGif(file: PickedFile): boolean {
  return file.type.toLowerCase().includes('gif') || file.name.toLowerCase().endsWith('.gif');
}

export interface PickedFile extends UploadFile {
  /** From the picker's asset metadata. 0 or undefined when the system
   * didn't report it, in which case we skip downscaling rather than guess. */
  width?: number;
  height?: number;
  fileSize?: number;
}

function toUploadFile(file: PickedFile): UploadFile {
  return { uri: file.uri, name: file.name, type: file.type };
}

function toJpegName(name: string): string {
  const dotIndex = name.lastIndexOf('.');
  return `${dotIndex > 0 ? name.slice(0, dotIndex) : name}.jpg`;
}

function shouldDownscale(file: PickedFile): boolean {
  if (file.type.startsWith('video')) return false;
  if (isGif(file)) return false;
  if (!file.width || !file.height) return false;
  return Math.max(file.width, file.height) > MAX_UPLOAD_DIMENSION || (file.fileSize ?? 0) > RE_ENCODE_FILE_SIZE_BYTES;
}

async function downscaleOne(file: PickedFile): Promise<UploadFile> {
  if (!shouldDownscale(file)) return toUploadFile(file);

  let context: ReturnType<typeof ImageManipulator.manipulate> | undefined;
  let rendered: Awaited<ReturnType<ReturnType<typeof ImageManipulator.manipulate>['renderAsync']>> | undefined;
  try {
    const longEdge = Math.max(file.width!, file.height!);
    const scale = Math.min(1, MAX_UPLOAD_DIMENSION / longEdge);
    context = ImageManipulator.manipulate(file.uri);
    rendered = await context
      .resize({ width: Math.round(file.width! * scale), height: Math.round(file.height! * scale) })
      .renderAsync();
    const result = await rendered.saveAsync({ compress: UPLOAD_JPEG_QUALITY, format: SaveFormat.JPEG });
    // The bytes are JPEG now, so the name has to say so — the backend picks
    // its processing branch off the extension (routes/uploads.ts).
    return { uri: result.uri, name: toJpegName(file.name), type: 'image/jpeg' };
  } catch (err) {
    // Never fail an upload over this. Decoding a 12MP photo costs ~48MB of
    // bitmap, which a low-end device with a small heap can genuinely refuse;
    // HEIC also can't be decoded at all below Android 9. In every such case
    // we simply upload the original, which is exactly the behaviour before
    // this optimisation existed — the server still produces its own display
    // copy and thumbnail from it.
    console.warn('Downscale failed, uploading original:', err);
    return toUploadFile(file);
  } finally {
    // Release the native bitmaps immediately rather than waiting for GC —
    // this is what keeps peak memory to one image at a time.
    rendered?.release();
    context?.release();
  }
}

/**
 * Shrinks picked images before they hit the network: typically 3–8MB of
 * camera JPEG/HEIC down to a few hundred KB, which is by far the largest
 * factor in how long a multi-photo upload takes on mobile data.
 *
 * Runs STRICTLY sequentially, never in parallel. The uploads themselves are
 * concurrent (they're network-bound), but image decoding is memory-bound:
 * holding several full-size bitmaps at once is the realistic way to OOM on
 * an older Android device. One at a time keeps peak memory flat regardless
 * of how many photos were picked.
 *
 * Videos and GIFs pass through untouched, and any per-file failure falls
 * back to the original file, so this can only ever make an upload smaller —
 * never fail one.
 */
export async function prepareForUpload(files: PickedFile[]): Promise<UploadFile[]> {
  const prepared: UploadFile[] = [];
  for (const file of files) {
    prepared.push(await downscaleOne(file));
  }
  return prepared;
}
