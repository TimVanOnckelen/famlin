import { z } from 'zod';
import { SUPPORTED_LANGUAGES } from './i18n/index.js';

// Matches exactly what routes/uploads.ts writes: /uploads/<uuid>.<allowed-ext>.
// Rejects arbitrary external URLs so a post/comment can't point at a
// tracking pixel or another group's asset path.
const UPLOAD_PATH_REGEX =
  /^\/uploads\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|gif|webp|heic|heif|mp4|mov|m4v|webm)$/;
const uploadPathSchema = z.string().regex(UPLOAD_PATH_REGEX, 'Must be an uploaded asset path');

export const loginBodySchema = z.object({
  idToken: z.string(),
  inviteToken: z.string().optional(),
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
    uploadedAssetUrls: z.array(uploadPathSchema).max(20).optional(),
  })
  .merge(locationFieldsSchema)
  .refine(requireLatLngTogether, { message: 'latitude and longitude must be provided together', path: ['latitude'] });

export const createCommentBodySchema = z.object({
  content: z.string().min(1).max(2000),
  parentId: z.string().optional(),
  assetUrl: uploadPathSchema.optional(),
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

export const updateUserBodySchema = notificationPrefsSchema.extend({
  avatarUrl: z.union([uploadPathSchema, z.string().url()]).optional().nullable(),
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
  oidcScopes: z.string().optional(),
  smtpHost: z.string().optional(),
  smtpPort: z.number().optional(),
  smtpUser: z.string().optional(),
  smtpPass: z.string().optional(),
  // Allows both a bare address and the "Name <email>" display-name format.
  smtpFrom: z.string().max(200).optional(),
  pushNotificationsEnabled: z.boolean().optional(),
  emailNotificationsEnabled: z.boolean().optional(),
});

export const createInviteBodySchema = z.object({
  email: z.string().email().optional(),
  expiresInDays: z.number().int().positive().max(365).optional(),
});

export const paginationQuerySchema = z.object({
  cursor: z.string().optional(),
  take: z.coerce.number().int().min(1).max(100).default(30),
});

export const inviteRegisterBodySchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email().optional(),
  password: z.string().min(8).max(100),
});
