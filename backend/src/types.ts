import { z } from 'zod';
import { SUPPORTED_LANGUAGES } from './i18n/index.js';

// Matches exactly what routes/uploads.ts writes: /uploads/<uuid>.<allowed-ext>.
// Rejects arbitrary external URLs so a post/comment can't point at a
// tracking pixel or another group's asset path.
const UPLOAD_PATH_REGEX =
  /^\/uploads\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|gif|webp|heic|heif|mp4|mov|m4v|webm)$/;
const uploadPathSchema = z.string().regex(UPLOAD_PATH_REGEX, 'Must be an uploaded asset path');

// Matches exactly what routes/immich.ts's proxy route serves:
// /api/immich/assets/<ImmichAlbumLink cuid>/<Immich asset uuid>/<variant>.<ext>.
// Unlike an upload path, the extension here reflects the real bytes each
// variant streams: `thumbnail`/`preview` always come back as a JPEG (Immich's
// thumbnail endpoint never returns video), so only `original` can be `.mp4`.
// Keeping this as strict as the upload path regex above is what stops a
// post/comment from pointing at an arbitrary URL. Use parseImmichAssetPath()
// below instead of re-deriving this shape elsewhere in the codebase.
const IMMICH_ASSET_PATH_REGEX =
  /^\/api\/immich\/assets\/([a-z0-9]+)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/(?:(thumbnail|preview)\.jpg|(original)\.(?:jpg|mp4))$/;

export interface ImmichAssetPath {
  linkId: string;
  assetId: string;
  variant: 'thumbnail' | 'preview' | 'original';
}

// Single source of truth for the Immich proxy URL shape — used by the zod
// validator below, by routes/immich.ts to validate :variantExt, and by
// routes/posts.ts to extract the embedded link id for the cross-group check.
export function parseImmichAssetPath(path: string): ImmichAssetPath | null {
  const match = path.match(IMMICH_ASSET_PATH_REGEX);
  if (!match) return null;
  const [, linkId, assetId, thumbOrPreview, original] = match;
  return { linkId, assetId, variant: (thumbOrPreview ?? original) as ImmichAssetPath['variant'] };
}

const immichAssetPathSchema = z
  .string()
  .refine((path) => parseImmichAssetPath(path) !== null, 'Must be a valid Immich asset path');
const assetPathSchema = z.union([uploadPathSchema, immichAssetPathSchema]);

export const loginBodySchema = z.object({
  idToken: z.string(),
  inviteToken: z.string().optional(),
});

// Used by the admin UI when the configured OIDC provider requires a client
// secret (e.g. Google) — the browser can't hold the secret, so it hands the
// authorization code to the backend instead of exchanging it itself.
export const oidcExchangeBodySchema = z.object({
  code: z.string(),
  redirectUri: z.string(),
  codeVerifier: z.string().optional(),
  inviteToken: z.string().optional(),
});

// Redeems the one-time code the mobile app receives from the
// famlin://oidc-callback deep link after GET /api/auth/oidc/mobile-callback
// completes a server-mediated (client-secret) login.
export const oidcMobileHandoffBodySchema = z.object({
  code: z.string(),
});

export const createGroupBodySchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
});

export const groupMemberBodySchema = z.object({
  userId: z.string(),
});

const locationFieldsSchema = z.object({
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  locationName: z.string().max(200).optional(),
});

function requireLatLngTogether(data: { latitude?: number; longitude?: number }) {
  return (data.latitude === undefined) === (data.longitude === undefined);
}

export const createPostBodySchema = z
  .object({
    groupId: z.string(),
    content: z.string().max(5000).optional(),
    type: z.enum(['UPDATE', 'MILESTONE']).default('UPDATE'),
    milestoneTag: z.string().max(50).optional(),
    uploadedAssetUrls: z.array(assetPathSchema).max(20).optional(),
  })
  .merge(locationFieldsSchema)
  .refine(requireLatLngTogether, { message: 'latitude and longitude must be provided together', path: ['latitude'] });

export const createCommentBodySchema = z.object({
  content: z.string().min(1).max(2000),
  parentId: z.string().optional(),
  assetUrl: assetPathSchema.optional(),
  // IDs the client resolved from the group member list while typing "@name" —
  // the server only trusts these as a set of candidate ids and still
  // re-validates each one is a current member of the post's group.
  mentionedUserIds: z.array(z.string()).max(20).optional(),
});

export const reactionTypeSchema = z.enum(['LIKE', 'LOVE', 'HAHA', 'WOW', 'SAD', 'CARE']);

export const reactionBodySchema = z.object({
  type: reactionTypeSchema.default('LIKE'),
});

export const updatePostBodySchema = z
  .object({
    content: z.string().max(5000).optional(),
    milestoneTag: z.string().max(50).optional(),
    latitude: z.number().min(-90).max(90).nullable().optional(),
    longitude: z.number().min(-180).max(180).nullable().optional(),
    locationName: z.string().max(200).nullable().optional(),
  })
  .refine((data) => (data.latitude == null) === (data.longitude == null), {
    message: 'latitude and longitude must be provided together',
    path: ['latitude'],
  });

export const updateCommentBodySchema = z.object({
  content: z.string().min(1).max(2000),
});

export const pushTokenBodySchema = z.object({
  token: z.string(),
});

export const createApiTokenBodySchema = z.object({
  name: z.string().min(1).max(100),
  // Omitted = the token never expires (revocable any time); capped at ten
  // years so a typo can't create an effectively-immortal "temporary" token.
  expiresInDays: z.number().int().positive().max(3650).optional(),
});

export const updateNotificationBodySchema = z.object({
  read: z.boolean(),
});

export const notificationPrefsSchema = z.object({
  emailOnNewPost: z.boolean().optional(),
  emailOnNewComment: z.boolean().optional(),
  emailOnNewLike: z.boolean().optional(),
  pushOnNewPost: z.boolean().optional(),
  pushOnNewComment: z.boolean().optional(),
  pushOnNewLike: z.boolean().optional(),
});

// Clients always upload the photo first and pass back the resulting
// /uploads path (see mobile ProfileScreen's pickAvatar flow) — an arbitrary
// external URL here would let a user beacon every group member's client to
// attacker-controlled infrastructure on avatar render. (OIDC-provided profile
// pictures are synced separately in routes/auth.ts and don't go through this
// schema.)
export const updateUserBodySchema = notificationPrefsSchema.extend({
  avatarUrl: uploadPathSchema.optional().nullable(),
});

export const adminUpdateUserBodySchema = notificationPrefsSchema.extend({
  isAdmin: z.boolean().optional(),
});

export const adminUpdateGroupBodySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional().nullable(),
});

export const passwordLoginBodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  inviteToken: z.string().optional(),
});

export const registerBodySchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(100),
  password: z.string().min(8).max(100),
  isAdmin: z.boolean().optional(),
});

export const setupBodySchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(100),
  password: z.string().min(8).max(100),
});

export const changePasswordBodySchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(100),
});

export const resetPasswordBodySchema = z.object({
  newPassword: z.string().min(8).max(100),
});

export const updateServerSettingsBodySchema = z.object({
  defaultLanguage: z.enum(SUPPORTED_LANGUAGES).optional(),
  appStoreUrl: z.union([z.literal(''), z.string().url()]).optional(),
  playStoreUrl: z.union([z.literal(''), z.string().url()]).optional(),
  allowedEmails: z.array(z.string().email()).optional(),
  oidcName: z.string().max(50).optional(),
  oidcIssuer: z.string().optional(),
  oidcClientId: z.string().optional(),
  oidcClientSecret: z.string().optional(),
  oidcScopes: z.string().optional(),
  smtpHost: z.string().optional(),
  smtpPort: z.number().optional(),
  smtpUser: z.string().optional(),
  smtpPass: z.string().optional(),
  // Allows both a bare address and the "Name <email>" display-name format.
  smtpFrom: z.string().max(200).optional(),
  pushNotificationsEnabled: z.boolean().optional(),
  emailNotificationsEnabled: z.boolean().optional(),
  immichServerUrl: z.union([z.literal(''), z.string().url()]).optional(),
  immichApiKey: z.string().optional(),
});

export const testImmichConnectionBodySchema = z.object({
  serverUrl: z.string().url(),
  apiKey: z.string().min(1),
});

export const linkImmichAlbumBodySchema = z.object({
  immichAlbumId: z.string().uuid(),
  albumName: z.string().min(1).max(200),
});

export const createInviteBodySchema = z.object({
  email: z.string().email().optional(),
  expiresInDays: z.number().int().positive().max(365).optional(),
});

export const paginationQuerySchema = z.object({
  cursor: z.string().optional(),
  take: z.coerce.number().int().min(1).max(100).default(30),
});

export const searchPostsQuerySchema = paginationQuerySchema.extend({
  groupId: z.string(),
  q: z.string().trim().min(1).max(200),
});

export const inviteRegisterBodySchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email().optional(),
  password: z.string().min(8).max(100),
});
