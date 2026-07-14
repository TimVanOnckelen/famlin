import { useState } from 'react';
import { Alert } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useTranslation } from 'react-i18next';

import { uploadMedia } from '@/api/uploads';

export interface PickedMediaAsset {
  uri: string;
  isVideo: boolean;
}

export interface PickAndUploadResult {
  assets: PickedMediaAsset[];
  urls: string[];
}

interface UsePickAndUploadMediaOptions {
  /** Forwarded to ImagePicker.launchImageLibraryAsync — this is where
   * single- vs multi-select, allowsEditing/aspect, mediaTypes, and
   * videoMaxDuration differ between call sites. */
  pickerOptions: ImagePicker.ImagePickerOptions;
  /** Filename prefix used when an asset has no fileName of its own.
   * Defaults to 'photo' (a video always falls back to 'video' regardless of
   * this prefix); ProfileScreen's avatar picker passes 'avatar' instead. */
  fileNamePrefix?: string;
  /** NewPostScreen's multi-select picker numbers its fallback names
   * (photo-0.jpg, photo-1.jpg, ...); the single-select flows don't. */
  includeIndexInName?: boolean;
  /** Invoked synchronously with the picked (not-yet-uploaded) assets, right
   * before the upload starts — lets the caller show an optimistic/pending
   * preview (NewPostScreen's pendingAssets, PostDetailScreen's
   * commentAttachment placeholder) while uploadMedia() is in flight. */
  onPicked?: (assets: PickedMediaAsset[]) => void;
  /** Invoked if the upload throws, after the failure alert is shown — lets
   * the caller undo anything set in onPicked (PostDetailScreen clears its
   * attachment preview) or log extra diagnostics (NewPostScreen). */
  onError?: (err: any) => void;
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
 */
export function usePickAndUploadMedia({
  pickerOptions,
  fileNamePrefix = 'photo',
  includeIndexInName = false,
  onPicked,
  onError,
}: UsePickAndUploadMediaOptions) {
  const { t } = useTranslation();
  const [uploading, setUploading] = useState(false);

  async function pick(): Promise<PickAndUploadResult | null> {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert(t('newPost.alerts.permissionRequiredTitle'), t('newPost.alerts.permissionRequiredMessage'));
      return null;
    }

    const result = await ImagePicker.launchImageLibraryAsync(pickerOptions);
    if (result.canceled) return null;

    const files = result.assets.map((asset, index) => {
      const isVideo = asset.type === 'video';
      const indexSuffix = includeIndexInName ? `-${index}` : '';
      return {
        uri: asset.uri,
        name: asset.fileName || `${isVideo ? 'video' : fileNamePrefix}${indexSuffix}.${isVideo ? 'mp4' : 'jpg'}`,
        type: asset.mimeType || (isVideo ? 'video/mp4' : 'image/jpeg'),
      };
    });

    const assets: PickedMediaAsset[] = files.map((file) => ({
      uri: file.uri,
      isVideo: file.type.startsWith('video'),
    }));
    onPicked?.(assets);

    try {
      setUploading(true);
      const urls = await uploadMedia(files);
      return { assets, urls };
    } catch (err: any) {
      onError?.(err);
      Alert.alert(t('newPost.alerts.uploadFailed'), err.response?.data?.error || err.message || t('common.tryAgain'));
      return null;
    } finally {
      setUploading(false);
    }
  }

  return { pick, uploading };
}
