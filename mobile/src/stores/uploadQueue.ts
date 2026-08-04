import { useMemo } from 'react';
import { create } from 'zustand';

import { uploadMediaFile, type UploadFile } from '@/api/uploads';

/**
 * How many uploads run at once. Small on purpose: phone uplink is the
 * bottleneck, and past ~3 concurrent streams they just divide the same
 * bandwidth while multiplying the chance of a timeout on a flaky mobile
 * connection.
 */
const MAX_CONCURRENT_UPLOADS = 3;

/** Progress patches below this delta are dropped — an upload emits dozens of
 * XHR progress events per file, and every one of them would otherwise
 * re-render every subscriber of this store. */
const PROGRESS_PATCH_THRESHOLD = 0.02;

export type UploadStatus = 'pending' | 'uploading' | 'done' | 'failed' | 'canceled';

export interface QueuedUpload {
  id: string;
  batchId: string;
  file: UploadFile;
  isVideo: boolean;
  status: UploadStatus;
  /** 0..1, only meaningful while status is 'uploading'. */
  progress: number;
  /** The `/uploads/...` path, once status is 'done'. */
  url: string | null;
  error: string | null;
}

interface UploadQueueState {
  items: QueuedUpload[];
}

/**
 * A module-level upload queue, deliberately NOT owned by any component.
 *
 * The point is that uploads outlive the screen that started them: closing
 * the check-in composer, navigating away from the new-post screen, or
 * unmounting a modal must not abort bytes already on the wire. Components
 * subscribe to a batch to render progress; the pump below keeps running
 * either way.
 *
 * This is an in-app queue, not an OS background transfer — it survives
 * navigation and unmount, but not the app being killed.
 */
export const useUploadQueue = create<UploadQueueState>(() => ({
  items: [],
}));

let nextItemId = 0;
let nextBatchId = 0;
let activeCount = 0;

/** In-flight aborts, keyed by item id — see cancelBatch. */
const abortControllers = new Map<string, AbortController>();

function patchItem(id: string, patch: Partial<QueuedUpload>): void {
  useUploadQueue.setState((state) => ({
    items: state.items.map((item) => (item.id === id ? { ...item, ...patch } : item)),
  }));
}

function errorMessage(err: any): string {
  return err?.response?.data?.error || err?.message || 'Upload failed';
}

/**
 * Starts as many queued uploads as the concurrency budget allows. Safe to
 * call at any time — it only ever picks up items still in 'pending'.
 */
function pump(): void {
  while (activeCount < MAX_CONCURRENT_UPLOADS) {
    // Re-read on every iteration: runUpload() flips the item it takes to
    // 'uploading' synchronously (before its first await), so the next find()
    // can't hand back the same item twice.
    const next = useUploadQueue.getState().items.find((item) => item.status === 'pending');
    if (!next) return;
    activeCount += 1;
    void runUpload(next.id);
  }
}

async function runUpload(id: string): Promise<void> {
  // Must happen before the first await — see the comment in pump().
  patchItem(id, { status: 'uploading', progress: 0, error: null });

  const item = useUploadQueue.getState().items.find((entry) => entry.id === id);
  if (!item) {
    activeCount -= 1;
    return;
  }

  const controller = new AbortController();
  abortControllers.set(id, controller);
  let lastProgress = 0;

  try {
    const url = await uploadMediaFile(item.file, {
      signal: controller.signal,
      onProgress: (fraction) => {
        if (fraction - lastProgress < PROGRESS_PATCH_THRESHOLD && fraction < 1) return;
        lastProgress = fraction;
        patchItem(id, { progress: fraction });
      },
    });
    patchItem(id, { status: 'done', progress: 1, url });
  } catch (err: any) {
    // A cancelled item was already moved to 'canceled' by cancelBatch; the
    // abort error it throws here must not overwrite that with 'failed'.
    const stillRunning = useUploadQueue.getState().items.find((entry) => entry.id === id)?.status === 'uploading';
    if (stillRunning) {
      patchItem(id, { status: 'failed', error: errorMessage(err) });
    }
  } finally {
    abortControllers.delete(id);
    activeCount -= 1;
    pump();
  }
}

/**
 * Adds files to the queue and starts uploading immediately. Returns the
 * batch id the caller uses to observe (selectBatch) or await (awaitBatch)
 * them. Order within a batch is preserved, so the resulting URL list matches
 * the order the user picked the photos in even though they finish out of
 * order.
 */
export function enqueueUploads(files: UploadFile[]): string {
  const batchId = `batch-${(nextBatchId += 1)}`;
  const items: QueuedUpload[] = files.map((file) => ({
    id: `upload-${(nextItemId += 1)}`,
    batchId,
    file,
    isVideo: file.type.startsWith('video'),
    status: 'pending',
    progress: 0,
    url: null,
    error: null,
  }));
  useUploadQueue.setState((state) => ({ items: [...state.items, ...items] }));
  pump();
  return batchId;
}

export function selectBatch(items: QueuedUpload[], batchId: string): QueuedUpload[] {
  return items.filter((item) => item.batchId === batchId);
}

function isSettled(item: QueuedUpload): boolean {
  return item.status === 'done' || item.status === 'failed' || item.status === 'canceled';
}

/** Resolves once every item in the batch has succeeded, failed, or been
 * cancelled. Never rejects — inspect the returned items for per-file
 * outcomes, since a batch can partially succeed. */
export function awaitBatch(batchId: string): Promise<QueuedUpload[]> {
  return new Promise((resolve) => {
    let unsubscribe: (() => void) | undefined;
    let settled = false;

    function check(items: QueuedUpload[]): boolean {
      const batch = selectBatch(items, batchId);
      if (batch.length === 0 || !batch.every(isSettled)) return false;
      settled = true;
      unsubscribe?.();
      resolve(batch);
      return true;
    }

    if (check(useUploadQueue.getState().items)) return;
    unsubscribe = useUploadQueue.subscribe((state) => check(state.items));
    // Guard against the subscription having fired synchronously before the
    // assignment above landed.
    if (settled) unsubscribe();
  });
}

/** Re-queues the failed items of a batch. Successful ones are left alone, so
 * a retry only re-sends what actually needs re-sending. */
export function retryBatch(batchId: string): void {
  useUploadQueue.setState((state) => ({
    items: state.items.map((item) =>
      item.batchId === batchId && (item.status === 'failed' || item.status === 'canceled')
        ? { ...item, status: 'pending', progress: 0, error: null }
        : item
    ),
  }));
  pump();
}

/** Aborts in-flight uploads in the batch and drops anything still pending. */
export function cancelBatch(batchId: string): void {
  const batch = selectBatch(useUploadQueue.getState().items, batchId);
  useUploadQueue.setState((state) => ({
    items: state.items.map((item) =>
      item.batchId === batchId && (item.status === 'pending' || item.status === 'uploading')
        ? { ...item, status: 'canceled' }
        : item
    ),
  }));
  for (const item of batch) {
    abortControllers.get(item.id)?.abort();
  }
}

/** Drops a settled batch from the store. Callers do this once they've taken
 * the URLs, so the queue doesn't grow for the lifetime of the session. */
export function clearBatch(batchId: string): void {
  useUploadQueue.setState((state) => ({ items: state.items.filter((item) => item.batchId !== batchId) }));
}

/** Drops one item — the composer's per-photo remove button. Aborts it first
 * if it's still on the wire, so removing a photo actually stops paying for
 * it. */
export function removeUpload(id: string): void {
  abortControllers.get(id)?.abort();
  abortControllers.delete(id);
  useUploadQueue.setState((state) => ({ items: state.items.filter((item) => item.id !== id) }));
}

export interface UploadSummary {
  total: number;
  done: number;
  failed: number;
  /** Still pending or uploading. */
  inFlight: number;
  allSettled: boolean;
  /** 0..1 across the whole set, counting a settled item as complete. */
  fraction: number;
}

export function summarizeUploads(items: QueuedUpload[]): UploadSummary {
  const total = items.length;
  const done = items.filter((item) => item.status === 'done').length;
  const failed = items.filter((item) => item.status === 'failed').length;
  const settled = items.filter(isSettled).length;
  const fraction =
    total === 0 ? 1 : items.reduce((sum, item) => sum + (isSettled(item) ? 1 : item.progress), 0) / total;
  return { total, done, failed, inFlight: total - settled, allSettled: settled === total, fraction };
}

/** Subscribes a component to the items of one or more batches, in queue
 * order. */
export function useBatchUploads(batchIds: string[]): QueuedUpload[] {
  const items = useUploadQueue((state) => state.items);
  // Keyed on the joined ids so the memo doesn't recompute just because the
  // caller passed a fresh array literal.
  const key = batchIds.join(',');
  return useMemo(
    () => items.filter((item) => key.split(',').includes(item.batchId)),
    [items, key]
  );
}

/** Test seam — resets module state between tests. */
export function resetUploadQueueForTests(): void {
  useUploadQueue.setState({ items: [] });
  abortControllers.clear();
  activeCount = 0;
  nextItemId = 0;
  nextBatchId = 0;
}
