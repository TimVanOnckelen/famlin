import bcrypt from 'bcryptjs';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/db.js';
import { createUserToken } from '../src/plugins/auth.js';

export async function buildTestApp() {
  const app = await buildApp();
  await app.ready();
  return app;
}

let counter = 0;
function unique(prefix: string) {
  counter += 1;
  return `${prefix}-${Date.now()}-${counter}`;
}

export async function createUser(
  overrides: Partial<{ email: string; name: string; isAdmin: boolean; password: string; tokenVersion: number }> = {}
) {
  const passwordHash = overrides.password ? await bcrypt.hash(overrides.password, 4) : undefined;

  return prisma.user.create({
    data: {
      email: overrides.email ?? `${unique('user')}@example.com`,
      name: overrides.name ?? 'Test User',
      isAdmin: overrides.isAdmin ?? false,
      passwordHash,
      tokenVersion: overrides.tokenVersion ?? 0,
    },
  });
}

export function authHeader(user: { id: string; email: string; name: string; isAdmin: boolean; tokenVersion?: number }) {
  const token = createUserToken({
    id: user.id,
    email: user.email,
    name: user.name,
    isAdmin: user.isAdmin,
    tokenVersion: user.tokenVersion ?? 0,
  });
  return { authorization: `Bearer ${token}` };
}

export async function createGroup(overrides: Partial<{ name: string; description: string }> = {}) {
  return prisma.group.create({
    data: {
      name: overrides.name ?? unique('Group'),
      description: overrides.description,
    },
  });
}

export async function addMember(groupId: string, userId: string) {
  return prisma.groupMember.create({ data: { groupId, userId } });
}

export async function createGroupWithMember(user: { id: string }, overrides?: Partial<{ name: string }>) {
  const group = await createGroup(overrides);
  await addMember(group.id, user.id);
  return group;
}

export async function createPost(overrides: { groupId: string; authorId: string } & Partial<{ content: string; uploadedAssetUrls: string[] }>) {
  return prisma.post.create({
    data: {
      groupId: overrides.groupId,
      authorId: overrides.authorId,
      content: overrides.content ?? 'Hello world',
      uploadedAssetUrls: overrides.uploadedAssetUrls ?? [],
    },
  });
}

export async function createComment(overrides: { postId: string; authorId: string } & Partial<{ content: string; parentId: string; assetUrl: string; attachmentUrl: string }>) {
  return prisma.comment.create({
    data: {
      postId: overrides.postId,
      authorId: overrides.authorId,
      content: overrides.content ?? 'A comment',
      parentId: overrides.parentId,
      assetUrl: overrides.assetUrl,
      attachmentUrl: overrides.attachmentUrl,
    },
  });
}
