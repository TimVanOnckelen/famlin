import crypto from 'crypto';
import { prisma } from '../db.js';
import { getAllSettings } from './settings.js';
import { createTransporter } from './notifications.js';

export function generateInviteToken(): string {
  return crypto.randomBytes(24).toString('base64url');
}

export type InviteValidity = 'not_found' | 'expired' | 'used' | null;

const INVITE_STATUS: Record<Exclude<InviteValidity, null>, { status: number; key: string }> = {
  not_found: { status: 404, key: 'errors.inviteNotFound' },
  expired: { status: 410, key: 'errors.inviteExpired' },
  used: { status: 410, key: 'errors.inviteUsed' },
};

// Shared by every route that resolves an invite token before doing anything
// else — maps `getValidInvite`'s reason to the (status, translated message)
// three call sites used to repeat by hand.
export function inviteFailureResponse(reason: InviteValidity, t: (key: string) => string) {
  if (!reason) return null;
  const { status, key } = INVITE_STATUS[reason];
  return { status, error: t(key) };
}

export async function getValidInvite(token: string) {
  const invite = await prisma.invite.findUnique({
    where: { token },
    include: {
      group: { select: { id: true, name: true, description: true } },
      createdBy: { select: { id: true, name: true } },
    },
  });

  if (!invite) {
    return { invite: null, reason: 'not_found' as InviteValidity };
  }
  if (invite.usedAt) {
    return { invite, reason: 'used' as InviteValidity };
  }
  if (invite.expiresAt && invite.expiresAt < new Date()) {
    return { invite, reason: 'expired' as InviteValidity };
  }

  return { invite, reason: null as InviteValidity };
}

// Joins `userId` to the invite's group and marks the invite used. Safe to
// call even if the user is already a member (e.g. re-opening the link).
//
// Runs as a transaction with an atomic conditional update (`usedAt: null` in
// the WHERE clause) rather than the previous read-then-write, which let two
// concurrent requests both pass the "is this invite still valid" check and
// both join a single-use invite's group.
export async function consumeInvite(token: string, userId: string) {
  await prisma.$transaction(async (tx) => {
    const invite = await tx.invite.findUnique({ where: { token } });
    if (!invite) return;

    if (invite.usedAt && invite.usedById !== userId) {
      // Already claimed by someone else — don't also join this user.
      return;
    }

    if (!invite.usedAt) {
      const claim = await tx.invite.updateMany({
        where: { id: invite.id, usedAt: null },
        data: { usedAt: new Date(), usedById: userId },
      });
      // Lost the race to claim it — a concurrent request already won.
      if (claim.count === 0) return;
    }

    await tx.groupMember.upsert({
      where: { groupId_userId: { groupId: invite.groupId, userId } },
      update: {},
      create: { groupId: invite.groupId, userId },
    });
  });
}

// Best-effort: never throws, since a failed email shouldn't fail invite
// creation (the admin can still share the link manually).
export async function sendInviteEmail(options: {
  email: string;
  groupName: string;
  inviterName: string;
  link: string;
}) {
  try {
    const settings = await getAllSettings();
    if (!settings.emailNotificationsEnabled) return;

    const transporter = await createTransporter();
    if (!transporter) return;

    await transporter.sendMail({
      from: settings.smtpFrom || 'Famlin <noreply@famlin.app>',
      to: options.email,
      subject: `${options.inviterName} invited you to join "${options.groupName}" on Famlin`,
      text: `${options.inviterName} invited you to join the "${options.groupName}" family group on Famlin.\n\nOpen this link to get started:\n${options.link}`,
    });
  } catch (err) {
    console.error('Failed to send invite email', err);
  }
}
