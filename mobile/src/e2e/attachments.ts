import * as ImageManipulator from 'expo-image-manipulator'
import { Directory, File, Paths } from 'expo-file-system'
import {
  decryptAttachment,
  encryptAttachment,
  uploadEncryptedAttachment,
  type E2eAttachmentV1,
} from '@famlin/api-client'
import { getUploadUrl } from '@/api/uploads'

// Photos only in v1 (a chunked format for video is a later version). Resized
// like every other chat photo, encrypted in memory with a fresh key, uploaded
// as an opaque .bin the server can neither read nor thumbnail.
const MAX_DIMENSION = 2048
const THUMBNAIL_SIZE = 48
export const E2E_PHOTO_DIR = 'e2e-photos'

export interface LocalPhoto {
  uri: string
  width?: number | null
  height?: number | null
}

function tempFile(name: string): File {
  const file = new File(Paths.cache, name)
  if (file.exists) file.delete()
  return file
}

/** Resize → encrypt → upload; returns what goes into the encrypted message content. */
export async function encryptAndUploadPhoto(photo: LocalPhoto): Promise<E2eAttachmentV1> {
  const resize =
    photo.width && photo.height && Math.max(photo.width, photo.height) > MAX_DIMENSION
      ? [{ resize: photo.width >= photo.height ? { width: MAX_DIMENSION } : { height: MAX_DIMENSION } }]
      : []
  const image = await ImageManipulator.manipulateAsync(photo.uri, resize, {
    compress: 0.8,
    format: ImageManipulator.SaveFormat.JPEG,
  })
  const thumb = await ImageManipulator.manipulateAsync(
    image.uri,
    [{ resize: image.width >= image.height ? { width: THUMBNAIL_SIZE } : { height: THUMBNAIL_SIZE } }],
    { compress: 0.5, format: ImageManipulator.SaveFormat.JPEG, base64: true }
  ).catch(() => null)

  const bytes = await new File(image.uri).bytes()
  const { data, key, nonce } = encryptAttachment(bytes)
  const blob = tempFile(`e2e-upload-${Date.now()}-${Math.random().toString(36).slice(2)}.bin`)
  try {
    blob.create()
    await blob.write(data)
    const url = await uploadEncryptedAttachment({
      uri: blob.uri,
      name: 'blob.bin',
      type: 'application/octet-stream',
    })
    return {
      url,
      key,
      nonce,
      mime: 'image/jpeg',
      size: bytes.length,
      width: image.width,
      height: image.height,
      ...(thumb?.base64 ? { thumbnail: thumb.base64 } : {}),
    }
  } finally {
    try {
      blob.delete()
    } catch {
      // Cache cleanup only.
    }
  }
}

const inFlight = new Map<string, Promise<string>>()

/**
 * Download + decrypt an encrypted photo into the cache directory (once per
 * message) and return its file uri. Throws if the blob is missing or doesn't
 * authenticate; the caller keeps the inline thumbnail and offers a retry.
 */
export function loadEncryptedPhoto(messageId: string, attachment: E2eAttachmentV1): Promise<string> {
  const existing = inFlight.get(messageId)
  if (existing) return existing
  const task = (async () => {
    const directory = new Directory(Paths.cache, E2E_PHOTO_DIR)
    directory.create({ idempotent: true, intermediates: true })
    const target = new File(directory, `${messageId.replace(/[^A-Za-z0-9_-]/g, '_')}.jpg`)
    if (target.exists) return target.uri
    const download = tempFile(`e2e-download-${Date.now()}.bin`)
    try {
      await File.downloadFileAsync(getUploadUrl(attachment.url), download, { idempotent: true })
      const plain = decryptAttachment(await download.bytes(), attachment.key, attachment.nonce)
      target.create()
      await target.write(plain)
      return target.uri
    } finally {
      try {
        download.delete()
      } catch {
        // Cache cleanup only.
      }
    }
  })().finally(() => inFlight.delete(messageId))
  inFlight.set(messageId, task)
  return task
}

export function thumbnailDataUri(attachment: E2eAttachmentV1): string | undefined {
  return attachment.thumbnail ? `data:image/jpeg;base64,${attachment.thumbnail}` : undefined
}
