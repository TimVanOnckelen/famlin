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

export interface PickedMediaAsset {
  uri: string
  isVideo: boolean
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
   * before the individual uploads start — lets the caller show an optimistic/pending
   * preview (NewPostScreen's pendingAssets, PostDetailScreen's
   * commentAttachment placeholder) while uploadMedia() is in flight. */
  onPicked?: (assets: PickedMediaAsset[]) => void
  /** Invoked if the upload throws, after the failure alert is shown — lets
   * the caller undo anything set in onPicked (PostDetailScreen clears its
   * attachment preview) or log extra diagnostics (NewPostScreen). */
  onError?: (err: any) => void
  /** Called as each independent request completes, without waiting for other files. */
  onUploaded?: (url: string, index: number) => void
  onSettled?: (index: number) => void
}

/**
 * Shared "pick from the device library, then upload" flow behind
 * NewPostScreen's photo picker, ProfileScreen's avatar picker, and
 * PostDetailScreen's comment attachment picker: permission check → alert on
 * denial → launchImageLibraryAsync → derive name/type per asset → upload →
 * alert on failure. Returns null on permission denial, on cancel, and when all
 * uploads fail (the failure alert has already been shown in the last
 * case) — callers only need to branch on truthy/falsy. Each call site still
 * owns its own pending/preview state and post-upload handling (added to a
 * list, saved as the avatar, attached to a comment).
 */
export function usePickAndUploadMedia({
  pickerOptions,
  fileNamePrefix = 'photo',
  includeIndexInName = false,
  onPicked,
  onError,
  onUploaded,
  onSettled,
}: UsePickAndUploadMediaOptions) {
  const { t } = useTranslation()
  const [uploading, setUploading] = useState(false)
  // Existing single-indicator callers use the average; the post composer
  // displays each file's own progress instead.
  const [progress, setProgress] = useState<number | null>(null)
  const [fileProgress, setFileProgress] = useState<number[]>([])

  async function pick(): Promise<PickAndUploadResult | null> {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (status !== 'granted') {
      Alert.alert(t('newPost.alerts.permissionRequiredTitle'), t('newPost.alerts.permissionRequiredMessage'))
      return null
    }

    const result = await ImagePicker.launchImageLibraryAsync(pickerOptions)
    if (result.canceled) return null

    const files = await Promise.all(
      result.assets.map(async (asset, index) => {
        const isVideo = asset.type === 'video'
        const indexSuffix = includeIndexInName ? `-${index}` : ''
        if (isVideo) {
          return {
            uri: asset.uri,
            name: asset.fileName || `video${indexSuffix}.mp4`,
            type: asset.mimeType || 'video/mp4',
          }
        }
        const { uri, resized } = await resizeForUpload(asset.uri, asset.width, asset.height)
        return resized
          ? { uri, name: `${fileNamePrefix}${indexSuffix}.jpg`, type: 'image/jpeg' }
          : {
              uri,
              name: asset.fileName || `${fileNamePrefix}${indexSuffix}.jpg`,
              type: asset.mimeType || 'image/jpeg',
            }
      })
    )

    const assets: PickedMediaAsset[] = files.map((file) => ({
      uri: file.uri,
      isVideo: file.type.startsWith('video'),
    }))
    onPicked?.(assets)

    try {
      setUploading(true)
      setProgress(0)
      const fractions = files.map(() => 0)
      setFileProgress(fractions)
      const results = await Promise.allSettled(
        files.map(async (file, index) => {
          try {
            const urls = await uploadMedia([file], (fraction) => {
              fractions[index] = Math.min(1, Math.max(0, fraction))
              setFileProgress([...fractions])
              setProgress(fractions.reduce((sum, value) => sum + value, 0) / files.length)
            })
            const url = urls[0]
            if (!url) throw new Error(t('common.tryAgain'))
            onUploaded?.(url, index)
            return url
          } finally {
            onSettled?.(index)
          }
        })
      )
      const failed = results.find((result) => result.status === 'rejected')
      if (failed?.status === 'rejected') {
        const err = failed.reason
        onError?.(err)
        Alert.alert(t('newPost.alerts.uploadFailed'), err.response?.data?.error || err.message || t('common.tryAgain'))
      }
      const successfulAssets: PickedMediaAsset[] = []
      const urls: string[] = []
      results.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          successfulAssets.push(assets[index])
          urls.push(result.value)
        }
      })
      return urls.length ? { assets: successfulAssets, urls } : null
    } finally {
      setUploading(false)
      setProgress(null)
      setFileProgress([])
    }
  }

  return { pick, uploading, progress, fileProgress }
}
