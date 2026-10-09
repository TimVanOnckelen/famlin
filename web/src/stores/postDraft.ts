import { createStore, type StoreApi } from 'zustand/vanilla';
import type { MediaAsset, UploadSessionMedia } from '@famlin/api-client';

export type PostDraftType = 'UPDATE' | 'MILESTONE' | 'POLL' | 'ALBUM';
export interface DraftAttachment {
  id: number;
  file: Pick<File, 'name' | 'type'>;
  previewUrl: string;
  url?: string;
  motionFile?: Pick<File, 'name' | 'type'>;
  motionId?: number;
  pending?: boolean;
}
export interface PostDraftState {
  selectedGroupIds: string[];
  selectedCircleId: string | null;
  type: PostDraftType;
  content: string;
  pollOptions: string[];
  albumTitle: string;
  files: DraftAttachment[];
  uploadSessionId: string;
  sessionMedia: UploadSessionMedia[];
  mediaAssets: MediaAsset[];
  excludedKeys: Set<string>;
  removedAttachments: Set<number>;
  pendingRequests: number;
  uploadError: boolean;
  publishing: boolean;
}
export interface PostDraftController {
  store: StoreApi<PostDraftState>;
  setField: <K extends keyof PostDraftState>(field: K, value: PostDraftState[K] | ((previous: PostDraftState[K]) => PostDraftState[K])) => void;
  allocateAttachmentId: () => number;
  clear: () => void;
}
const drafts = new Map<string, PostDraftController>();
const draftTypes = ['UPDATE', 'MILESTONE', 'POLL', 'ALBUM'];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uploadUrl = (value: unknown): value is string => typeof value === 'string' && /^\/uploads\/[^/?#]+$/.test(value);
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === 'string');

export function postDraftStorageKey(userId?: string): string | null {
  return userId ? `famlin:post-draft:v1:${userId}` : null;
}

function restore(key: string | null, initial: PostDraftState): PostDraftState {
  if (!key) return initial;
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(key) ?? 'null');
    if (!record(saved) || saved.version !== 1 || typeof saved.uploadSessionId !== 'string' || !uuid.test(saved.uploadSessionId)) return initial;
    const files = Array.isArray(saved.files) ? saved.files.filter((item): item is { id: number; name: string; type: string; url: string } =>
      record(item) && typeof item.id === 'number' && Number.isInteger(item.id) && item.id >= 0 && typeof item.name === 'string' && typeof item.type === 'string' && uploadUrl(item.url))
      .map((item) => ({ id: item.id, file: { name: item.name, type: item.type }, url: item.url, previewUrl: '' })) : [];
    const mediaAssets = Array.isArray(saved.mediaAssets) ? saved.mediaAssets.filter((item): item is MediaAsset => record(item)
      && typeof item.assetId === 'string' && ['IMAGE', 'VIDEO'].includes(String(item.type))
      && ['thumbnailUrl', 'previewUrl', 'originalUrl'].every((field) => typeof item[field] === 'string' && String(item[field]).startsWith('/'))) : [];
    const sessionMedia = Array.isArray(saved.sessionMedia) ? saved.sessionMedia.filter((item): item is UploadSessionMedia => record(item)
      && uploadUrl(item.url) && ['queued', 'processing', 'ready', 'failed'].includes(String(item.status))
      && (item.thumbnailUrl === null || uploadUrl(item.thumbnailUrl))
      && (item.videoUrl == null || uploadUrl(item.videoUrl)) && (item.kind == null || ['image', 'video', 'livePhoto'].includes(String(item.kind)))) : [];
    return {
      ...initial,
      uploadSessionId: saved.uploadSessionId,
      selectedGroupIds: strings(saved.selectedGroupIds) ? saved.selectedGroupIds : initial.selectedGroupIds,
      selectedCircleId: typeof saved.selectedCircleId === 'string' ? saved.selectedCircleId : null,
      type: draftTypes.includes(String(saved.type)) ? saved.type as PostDraftType : initial.type,
      content: typeof saved.content === 'string' ? saved.content.slice(0, 5000) : '',
      albumTitle: typeof saved.albumTitle === 'string' ? saved.albumTitle.slice(0, 120) : '',
      pollOptions: strings(saved.pollOptions) && saved.pollOptions.length >= 2 ? saved.pollOptions.slice(0, 10).map((item) => item.slice(0, 100)) : initial.pollOptions,
      files, mediaAssets, sessionMedia,
      excludedKeys: new Set(strings(saved.excludedKeys) ? saved.excludedKeys.filter((item) => uuid.test(item)) : []),
    };
  } catch { return initial; }
}

// The controller survives modal unmounts, so in-flight uploads finish into the
// same draft and update a reopened editor. Only completed URLs go to storage.
export function getPostDraft(key: string | null, initial: PostDraftState): PostDraftController {
  const existing = key ? drafts.get(key) : undefined;
  if (existing) {
    const current = existing.store.getState();
    const additions = initial.mediaAssets.filter((asset) => !current.mediaAssets.some((saved) => saved.assetId === asset.assetId));
    if (additions.length && !current.publishing) existing.setField('mediaAssets', [...current.mediaAssets, ...additions]);
    return existing;
  }
  const restored = restore(key, initial);
  const state = { ...restored, mediaAssets: [...restored.mediaAssets,
    ...initial.mediaAssets.filter((asset) => !restored.mediaAssets.some((saved) => saved.assetId === asset.assetId))] };
  const store = createStore<PostDraftState>(() => state);
  let nextAttachmentId = Math.max(-1, ...state.files.map((item) => item.id)) + 1;
  let clearing = false;
  const persist = (draft: PostDraftState) => {
    if (!key || clearing) return;
    try {
      localStorage.setItem(key, JSON.stringify({
        version: 1,
        selectedGroupIds: draft.selectedGroupIds, selectedCircleId: draft.selectedCircleId,
        type: draft.type, content: draft.content, pollOptions: draft.pollOptions, albumTitle: draft.albumTitle,
        uploadSessionId: draft.uploadSessionId, sessionMedia: draft.sessionMedia, mediaAssets: draft.mediaAssets,
        excludedKeys: [...draft.excludedKeys],
        files: draft.files.filter((item) => !!item.url).map((item) => ({ id: item.id, name: item.file.name, type: item.file.type, url: item.url })),
      }));
    } catch { /* An unavailable/full localStorage must not break posting. */ }
  };
  store.subscribe((next, previous) => {
    const retained = new Set(next.files.map((item) => item.previewUrl));
    for (const file of previous.files) if (file.previewUrl && !retained.has(file.previewUrl)) URL.revokeObjectURL(file.previewUrl);
    persist(next);
  });
  const controller: PostDraftController = {
    store,
    setField: (field, value) => store.setState((previous) => {
      const next = typeof value === 'function' ? (value as (current: typeof previous[typeof field]) => typeof previous[typeof field])(previous[field]) : value;
      return Object.is(previous[field], next) ? previous : { ...previous, [field]: next };
    }),
    allocateAttachmentId: () => nextAttachmentId++,
    clear: () => {
      clearing = true;
      store.setState({ ...initial, uploadSessionId: crypto.randomUUID(), files: [], sessionMedia: [], mediaAssets: [],
        excludedKeys: new Set(), removedAttachments: new Set(), pendingRequests: 0, uploadError: false, publishing: false });
      if (key) { drafts.delete(key); try { localStorage.removeItem(key); } catch { /* unavailable storage */ } }
    },
  };
  if (key) drafts.set(key, controller);
  if (state.content || state.files.length || state.mediaAssets.length || state.albumTitle || state.pollOptions.some(Boolean)) persist(state);
  return controller;
}
