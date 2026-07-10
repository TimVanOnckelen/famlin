// Named (not `export *`) re-exports here are deliberate: TS compiles
// `export *` to a runtime `__exportStar(require(...), exports)` call, whose
// re-exported names Rollup's production build can't statically resolve —
// that breaks `vite build` for any consumer (e.g. web/) even though it works
// fine under ts-jest/Metro/`tsc --noEmit`. Named re-exports compile to
// statically analyzable `Object.defineProperty` getters instead.
export type { StorageAdapter } from './storage';
export { setStorageAdapter, getStorageAdapter, TOKEN_KEY, SERVER_URL_KEY } from './storage';

export {
  api,
  setApiBaseUrl,
  getCurrentServerUrl,
  setMediaToken,
  getCurrentMediaToken,
  initApiBaseUrl,
  setUnauthorizedHandler,
} from './client';

export type { LoginResponse, OidcConfig, NotificationPrefs, UpdateMeBody } from './auth';
export {
  fetchOidcConfig,
  loginWithOidc,
  exchangeOidcMobileHandoff,
  exchangeOidcCode,
  loginWithPassword,
  fetchMe,
  updateMe,
  fetchNotificationConfig,
  fetchServerInfo,
  changePassword,
} from './auth';

export {
  generateRandomString,
  generateCodeChallenge,
  startBrowserOidcLogin,
  completeBrowserOidcLogin,
  clearBrowserOidcLogin,
} from './oidcBrowser';

export type { ImmichGroupAlbum, ImmichAsset } from './immich';
export { getGroupImmichAlbums, getImmichAlbumAssets } from './immich';

export type { InvitePreview } from './invites';
export { fetchInvitePreview, registerViaInvite, acceptInvite } from './invites';

export { getUploadUrl, refreshMediaToken, ensureFreshMediaToken } from './uploads';

export type { ReactionType, User, Group, Post, Comment, Notification } from './types';
export { REACTION_TYPES } from './types';

export { patchPostInCaches } from './postCache';

export type { GroupMember } from './groups';
export { fetchGroups, fetchGroupMembers } from './groups';

export type { FetchPostsParams, PostsPage, SearchPostsParams, CreatePostBody, ReactionResult } from './posts';
export {
  fetchPosts,
  fetchPost,
  fetchOnThisDay,
  searchPosts,
  fetchFavorites,
  createPost,
  updatePost,
  deletePost,
  reactToPost,
  toggleFavoritePost,
} from './posts';

export type { CreateCommentBody } from './comments';
export { fetchComments, createComment, updateComment, deleteComment, reactToComment } from './comments';

export {
  fetchNotifications,
  fetchUnreadNotificationCount,
  markNotificationRead,
  markAllNotificationsRead,
} from './notifications';

export { registerPushToken, unregisterPushToken } from './pushTokens';

export type { ApiToken, CreatedApiToken } from './apiTokens';
export { fetchApiTokens, createApiToken, revokeApiToken } from './apiTokens';
