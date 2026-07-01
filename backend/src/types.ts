import { z } from 'zod';

export const loginBodySchema = z.object({
  idToken: z.string(),
});

export const createGroupBodySchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
});

export const groupMemberBodySchema = z.object({
  userId: z.string(),
});

export const createPostBodySchema = z.object({
  groupId: z.string(),
  content: z.string().max(5000).optional(),
  type: z.enum(['UPDATE', 'MILESTONE']).default('UPDATE'),
  milestoneTag: z.string().max(50).optional(),
  immichAlbumId: z.string().optional(),
  immichAssetIds: z.array(z.string()).optional(),
  uploadedAssetUrls: z.array(z.string()).optional(),
});

export const createCommentBodySchema = z.object({
  content: z.string().min(1).max(2000),
});

export const pushTokenBodySchema = z.object({
  token: z.string(),
});

export const updateNotificationBodySchema = z.object({
  read: z.boolean(),
});

export const updateUserBodySchema = z.object({
  emailNotificationsEnabled: z.boolean().optional(),
});
