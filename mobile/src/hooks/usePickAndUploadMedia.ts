import { useState } from 'react'
import { Alert } from 'react-native'
import * as ImagePicker from 'expo-image-picker'
import * as ImageManipulator from 'expo-image-manipulator'
import { useTranslation } from 'react-i18next'

import { uploadMedia } from '@/api/uploads'

// The backend re-encodes every upload down to a 1920px display copy anyway
// (see backend/src/services/uploadVariants.ts) — a modern phone photo is
// routinely 12MP+ (several MB, often HEIC on iOS), so uploading it at full
// resolution just spends time on the wire for detail nobody will see. This
// cap is well above the backend's own display size so quality headroom
// (cropping, a future higher-res display target) isn't lost, while still
// cutting the true outliers (48MP sensors) down to a reasonable upload size.
const MAX_UPLOAD_DIMENSION = 2560

// Downscales an image asset in place on-device before it's uploaded. Returns
// the original uri untouched when the asset is already small enough — most
// avatar-style picks and older/lower-res photos never hit the manipulator at
// all. Resizing also re-encodes to JPEG, which is a deliberate side effect
// for HEIC sources: it avoids the backend's synchronous HEIC decode entirely
// for anything picked through this hook going forward.
async function resizeForUpload(
  uri: string,
  width?: number,
  height?: number
): Promise<{ uri: string; resized: boolean }> {
  if (!width || !height || Math.max(width, height) <= MAX_UPLOAD_DIMENSION) {
    return { uri, resized: false }
  }
  const resize = width >= height ? { width: MAX_UPLOAD_DIMENSION } : { height: MAX_UPLOAD_DIMENSION }
  const manipulated = await ImageManipulator.manipulateAsync(uri, [{ resize }], {
    compress: 0.85,
    format: ImageManipulator.SaveFormat.JPEG,
  })
  return { uri: manipulated.uri, resized: true }
}

// The picker's `quality: 0.8` — the OS picker re-encodes with it before the
// asset ever reaches us; a file shared in from another app skips the picker,
// so it gets the same compression here instead.
const PICKER_IMAGE_QUALITY = 0.8

// Re-encodes a shared image the way the picker would have (JPEG at the
// picker's quality), downscaling it past MAX_UPLOAD_DIMENSION like any picked
// photo. When the share didn't report dimensions, the first re-encode
// reveals them. GIFs are left alone, as re-encoding would drop the animation.
async function compressSharedImage(
  uri: string,
  mimeType: string | undefined,
  width?: number | null,
  height?: number | null
): Promise<{ uri: string; recompressed: boolean }> {
  if (mimeType === 'image/gif') return { uri, recompressed: false }
  const options = { compress: PICKER_IMAGE_QUALITY, format: ImageManipulator.SaveFormat.JPEG }
  const resizeFor = (w: number, h: number) =>
    Math.max(w, h) > MAX_UPLOAD_DIMENSION
      ? [{ resize: w >= h ? { width: MAX_UPLOAD_DIMENSION } : { height: MAX_UPLOAD_DIMENSION } }]
      : []
  if (width && height) {
    const manipulated = await ImageManipulator.manipulateAsync(uri, resizeFor(width, height), options)
    return { uri: manipulated.uri, recompressed: true }
  }
  const encoded = await ImageManipulator.manipulateAsync(uri, [], options)
  const actions = resizeFor(encoded.width, encoded.height)
  if (actions.length === 0) return { uri: encoded.uri, recompressed: true }
  const resized = await ImageManipulator.manipulateAsync(encoded.uri, actions, options)
  return { uri: resized.uri, recompressed: true }
}

export interface PickedMediaAsset {
  uri: string
  isVideo: boolean
}

/** A local photo/video to upload — from the picker, or shared into the app
 * from the OS share sheet (see `upload`). */
export interface UploadableMediaAsset {
  uri: string
  isVideo: boolean
  width?: number | null
  height?: number | null
  fileName?: string | null
  mimeType?: string | null
  /** Set for files that didn't come through the picker (an OS share), so
   * they get the compression the picker would otherwise have applied. */
  fromOutsidePicker?: boolean
}

export interface PickAndUploadResult {
  assets: PickedMediaAsset[]
  urls: string[]
}

interface UsePickAndUploadMediaOptions {
  /** Forwarded to ImagePicker.launchImageLibraryAsync — this is where
   * single- vs multi-select, allowsEditing/aspect, mediaTypes, and
   * videoMaxDuration differ between call sites. */
  pickerOptions: ImagePicker.ImagePickerOptions
  /** Filename prefix used when an asset has no fileName of its own.
   * Defaults to 'photo' (a video always falls back to 'video' regardless of
   * this prefix); ProfileScreen's avatar picker passes 'avatar' instead. */
  fileNamePrefix?: string
  /** NewPostScreen's multi-select picker numbers its fallback names
   * (photo-0.jpg, photo-1.jpg, ...); the single-select flows don't. */
  includeIndexInName?: boolean
  /** Invoked synchronously with the picked (not-yet-uploaded) assets, right
   * before the upload starts — lets the caller show an optimistic/pending
   * preview (NewPostScreen's pendingAssets, PostDetailScreen's
   * commentAttachment placeholder) while uploadMedia() is in flight. */
  onPicked?: (assets: PickedMediaAsset[]) => void
  /** Invoked if the upload throws, after the failure alert is shown — lets
   * the caller undo anything set in onPicked (PostDetailScreen clears its
   * attachment preview) or log extra diagnostics (NewPostScreen). */
  onError?: (err: any) => void
}

/**
 * Shared "pick from the device library, then upload" flow behind
 * NewPostScreen's photo picker, ProfileScreen's avatar picker, and
 * PostDetailScreen's comment attachment picker: permission check → alert on
 * denial → launchImageLibraryAsync → derive name/type per asset → upload →
 * alert on failure. Returns null on permission denial, on cancel, and on
 * upload failure (the failure alert has already been shown in the last
 * case) — callers only need to branch on truthy/falsy. Each call site still
 * owns its own pending/preview state and post-upload handling (added to a
 * list, saved as the avatar, attached to a comment).
 *
 * `upload` is the second half on its own, for files that are already on the
 * device without going through the picker — photos/videos shared into the
 * app from the OS share sheet (NewPostScreen, issue #199).
 */
export function usePickAndUploadMedia({
  pickerOptions,
  fileNamePrefix = 'photo',
  includeIndexInName = false,
  onPicked,
  onError,
}: UsePickAndUploadMediaOptions) {
  const { t } = useTranslation()
  const [uploading, setUploading] = useState(false)
  // Fraction (0-1) of the in-flight batch upload's bytes sent so far — null
  // until the request actually starts streaming (see uploadMedia's
  // onProgress). One combined figure for the whole batch, not per-file,
  // since the client sends every asset as one multipart request.
  const [progress, setProgress] = useState<number | null>(null)

  async function toUploadFile(asset: UploadableMediaAsset, index: number) {
    const indexSuffix = includeIndexInName ? `-${index}` : ''
    if (asset.isVideo) {
      return {
        uri: asset.uri,
        name: asset.fileName || `video${indexSuffix}.mp4`,
        type: asset.mimeType || 'video/mp4',
      }
    }
    if (asset.fromOutsidePicker) {
      const { uri, recompressed } = await compressSharedImage(
        asset.uri,
        asset.mimeType ?? undefined,
        asset.width,
        asset.height
      )
      return recompressed
        ? { uri, name: `${fileNamePrefix}${indexSuffix}.jpg`, type: 'image/jpeg' }
        : { uri, name: asset.fileName || `${fileNamePrefix}${indexSuffix}.gif`, type: asset.mimeType || 'image/gif' }
    }
    const { uri, resized } = await resizeForUpload(asset.uri, asset.width ?? undefined, asset.height ?? undefined)
    return resized
      ? { uri, name: `${fileNamePrefix}${indexSuffix}.jpg`, type: 'image/jpeg' }
      : {
          uri,
          name: asset.fileName || `${fileNamePrefix}${indexSuffix}.jpg`,
          type: asset.mimeType || 'image/jpeg',
        }
  }

  /**
   * Uploads the given local assets. By default as one multipart batch that
   * fails as a whole, like a picker pick. With `individually`, each file is
   * its own request: one that fails is reported (one alert for the lot) and
   * left out, while the rest still upload — what an OS share wants, since
   * its files can't simply be re-picked. Returns null only when nothing at
   * all was uploaded.
   */
  async function upload(
    sourceAssets: UploadableMediaAsset[],
    { individually = false }: { individually?: boolean } = {}
  ): Promise<PickAndUploadResult | null> {
    if (sourceAssets.length === 0) return null
    let files: { uri: string; name: string; type: string }[]
    try {
      files = await Promise.all(sourceAssets.map(toUploadFile))
    } catch (err: any) {
      onError?.(err)
      Alert.alert(t('newPost.alerts.uploadFailed'), err.message || t('common.tryAgain'))
      return null
    }

    const assets: PickedMediaAsset[] = files.map((file) => ({
      uri: file.uri,
      isVideo: file.type.startsWith('video'),
    }))
    onPicked?.(assets)

    setUploading(true)
    setProgress(0)
    try {
      if (!individually) {
        const urls = await uploadMedia(files, setProgress)
        return { assets, urls }
      }
      const uploaded: PickAndUploadResult = { assets: [], urls: [] }
      let lastError: any = null
      for (const [index, file] of files.entries()) {
        try {
          const urls = await uploadMedia([file], (fraction) => setProgress((index + fraction) / files.length))
          uploaded.assets.push(assets[index])
          uploaded.urls.push(...urls)
        } catch (err: any) {
          lastError = err
        }
      }
      if (lastError) {
        onError?.(lastError)
        Alert.alert(
          t('newPost.alerts.uploadFailed'),
          lastError.response?.data?.error || lastError.message || t('common.tryAgain')
        )
      }
      return uploaded.urls.length > 0 ? uploaded : null
    } catch (err: any) {
      onError?.(err)
      Alert.alert(t('newPost.alerts.uploadFailed'), err.response?.data?.error || err.message || t('common.tryAgain'))
      return null
    } finally {
      setUploading(false)
      setProgress(null)
    }
  }

  async function pick(): Promise<PickAndUploadResult | null> {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (status !== 'granted') {
      Alert.alert(t('newPost.alerts.permissionRequiredTitle'), t('newPost.alerts.permissionRequiredMessage'))
      return null
    }

    const result = await ImagePicker.launchImageLibraryAsync(pickerOptions)
    if (result.canceled) return null

    return upload(
      result.assets.map((asset) => ({
        uri: asset.uri,
        isVideo: asset.type === 'video',
        width: asset.width,
        height: asset.height,
        fileName: asset.fileName,
        mimeType: asset.mimeType,
      }))
    )
  }

  return { pick, upload, uploading, progress }
}
