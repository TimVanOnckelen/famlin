import { useCallback, useEffect, useState } from 'react';
import { Alert } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useTranslation } from 'react-i18next';

import type { UploadFile } from '@/api/uploads';
import { prepareForUpload, type PickedFile } from '@/utils/prepareUpload';
import {
  awaitBatch,
  clearBatch,
  enqueueUploads,
  selectBatch,
  useUploadQueue,
  type QueuedUpload,
} from '@/stores/uploadQueue';

export interface PickedMediaAsset {
  uri: string;
  isVideo: boolean;
}

export interface PickAndUploadResult {
  assets: PickedMediaAsset[];
  urls: string[];
}

export interface PickToQueueResult {
  batchId: string;
  assets: PickedMediaAsset[];
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
   * commentAttachment placeholder) while the upload is in flight. */
  onPicked?: (assets: PickedMediaAsset[]) => void;
  /** Invoked if every upload in the batch fails, after the failure alert is
   * shown — lets the caller undo anything set in onPicked (PostDetailScreen
   * clears its attachment preview) or log extra diagnostics (NewPostScreen). */
  onError?: (err: any) => void;
}

/**
 * Shared "pick from the device library, then upload" flow behind
 * NewPostScreen's photo picker, ProfileScreen's avatar picker,
 * PostDetailScreen's comment attachment picker, and the check-in/album
 * composers: permission check → alert on denial → launchImageLibraryAsync →
 * derive name/type per asset → downscale → upload → alert on failure.
 *
 * Uploads themselves run through the module-level queue in
 * stores/uploadQueue.ts (bounded concurrency, one request per file, per-file
 * progress and retry), so they survive the calling component unmounting.
 * Two entry points:
 *
 *   - `pick()` keeps the original blocking contract: it resolves once the
 *     whole batch has settled. Returns null on permission denial, on cancel,
 *     and when every file failed (the failure alert has already been shown
 *     in the last case) — callers only need to branch on truthy/falsy. A
 *     PARTIALLY failed batch resolves with the files that did make it, plus
 *     an alert naming how many didn't, rather than throwing the successful
 *     uploads away.
 *   - `pickToQueue()` returns as soon as the picker closes, handing back the
 *     batch id so the caller can render live progress and let the user carry
 *     on (the check-in composer's non-blocking submit).
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
  const [activeBatchId, setActiveBatchId] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);

  // Aggregate 0..1 progress across the batch this hook most recently
  // started. Lives here rather than in the store so each call site tracks
  // only its own batch.
  useEffect(() => {
    if (!activeBatchId) {
      setProgress(0);
      return;
    }
    const compute = (items: QueuedUpload[]): number => {
      const batch = selectBatch(items, activeBatchId);
      if (batch.length === 0) return 0;
      const total = batch.reduce((sum, item) => sum + (item.status === 'done' ? 1 : item.progress), 0);
      return total / batch.length;
    };
    setProgress(compute(useUploadQueue.getState().items));
    return useUploadQueue.subscribe((state) => setProgress(compute(state.items)));
  }, [activeBatchId]);

  /** Permission + picker + per-asset name/type derivation + downscale. */
  const pickFiles = useCallback(
    async (): Promise<{ assets: PickedMediaAsset[]; files: UploadFile[] } | null> => {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(t('newPost.alerts.permissionRequiredTitle'), t('newPost.alerts.permissionRequiredMessage'));
        return null;
      }

      const result = await ImagePicker.launchImageLibraryAsync(pickerOptions);
      if (result.canceled) return null;

      const picked: PickedFile[] = result.assets.map((asset, index) => {
        const isVideo = asset.type === 'video';
        const indexSuffix = includeIndexInName ? `-${index}` : '';
        return {
          uri: asset.uri,
          name: asset.fileName || `${isVideo ? 'video' : fileNamePrefix}${indexSuffix}.${isVideo ? 'mp4' : 'jpg'}`,
          type: asset.mimeType || (isVideo ? 'video/mp4' : 'image/jpeg'),
          // Drives the downscale decision below — the picker already knows
          // these, so no extra decode is needed just to measure the image.
          width: asset.width,
          height: asset.height,
          fileSize: asset.fileSize,
        };
      });

      const assets: PickedMediaAsset[] = picked.map((file) => ({
        uri: file.uri,
        isVideo: file.type.startsWith('video'),
      }));
      onPicked?.(assets);

      // Shrink images before they hit the network. Never throws — a photo
      // that can't be downscaled is passed through at full size.
      const files = await prepareForUpload(picked);
      return { assets, files };
    },
    [fileNamePrefix, includeIndexInName, onPicked, pickerOptions, t]
  );

  const pick = useCallback(async (): Promise<PickAndUploadResult | null> => {
    const picked = await pickFiles();
    if (!picked) return null;

    setUploading(true);
    const batchId = enqueueUploads(picked.files);
    setActiveBatchId(batchId);
    try {
      const settled = await awaitBatch(batchId);
      const succeeded = settled.filter((item) => item.status === 'done');
      const failedCount = settled.length - succeeded.length;

      if (succeeded.length === 0) {
        const firstError = settled.find((item) => item.error)?.error;
        onError?.(new Error(firstError || 'Upload failed'));
        Alert.alert(t('newPost.alerts.uploadFailed'), firstError || t('common.tryAgain'));
        return null;
      }
      if (failedCount > 0) {
        // Partial success: keep what landed rather than discarding the whole
        // pick, and tell the user exactly how much didn't make it.
        Alert.alert(
          t('newPost.alerts.uploadFailed'),
          t('newPost.alerts.uploadPartiallyFailed', { failed: failedCount, total: settled.length })
        );
      }

      const succeededUris = new Set(succeeded.map((item) => item.file.uri));
      return {
        assets: picked.assets.filter((asset) => succeededUris.has(asset.uri)),
        urls: succeeded.map((item) => item.url!),
      };
    } finally {
      clearBatch(batchId);
      setActiveBatchId(null);
      setUploading(false);
    }
  }, [onError, pickFiles, t]);

  const pickToQueue = useCallback(async (): Promise<PickToQueueResult | null> => {
    const picked = await pickFiles();
    if (!picked) return null;
    const batchId = enqueueUploads(picked.files);
    setActiveBatchId(batchId);
    return { batchId, assets: picked.assets };
  }, [pickFiles]);

  return { pick, pickToQueue, uploading, progress };
}
