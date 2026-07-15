import { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';
import { createUserToken } from '../plugins/auth.js';
import { getT } from '../i18n/index.js';
import { getValidInvite, consumeInvite, inviteFailureResponse } from '../services/invites.js';
import { sanitizeUser, hashPassword } from '../services/users.js';
import { inviteRegisterBodySchema } from '../types.js';

export default async function inviteRoutes(fastify: FastifyInstance) {
  // Public: lets a client preview an invite before the user logs in or
  // registers (group name, who invited them, whether it's still usable).
  // Rate limited (token enumeration protection) — looser than
  // POST /:token/register since this is just a read-only preview, not an
  // account-creation surface, but still capped for real.
  fastify.get(
    '/:token',
    { config: { rateLimit: { max: 30, timeWindow: '15 minutes' } } },
    async (request) => {
      const { token } = request.params as { token: string };
      const { invite, reason } = await getValidInvite(token);

      if (!invite) {
        return { status: 'not_found' };
      }

      return {
        status: reason ?? 'valid',
        groupName: invite.group.name,
        groupDescription: invite.group.description,
        inviterName: invite.createdBy?.name ?? null,
        email: invite.email,
      };
    }
  );

  // Public: self-service local account creation for someone who doesn't
  // have one yet — the invite itself is the authorization, bypassing the
  // normally admin-only /auth/register and the allowedEmails whitelist.
  fastify.post(
    '/:token/register',
    { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } },
    async (request, reply) => {
      const t = getT(request);
      const { token } = request.params as { token: string };
      const { invite, reason } = await getValidInvite(token);

      const failure = inviteFailureResponse(reason, t);
      if (failure) return reply.status(failure.status).send({ error: failure.error });

      const body = inviteRegisterBodySchema.parse(request.body);
      const email = (invite!.email || body.email)?.toLowerCase().trim();
      if (!email) {
        return reply.status(400).send({ error: t('errors.emailRequired') });
      }
      if (invite!.email && body.email && body.email.toLowerCase().trim() !== invite!.email) {
        return reply.status(403).send({ error: t('errors.inviteEmailMismatch') });
      }

      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing) {
        return reply.status(409).send({ error: t('errors.userAlreadyExists') });
      }

      const passwordHash = await hashPassword(body.password);
      const user = await prisma.user.create({
        data: { email, name: body.name, passwordHash },
      });

      await consumeInvite(token, user.id);

      const authToken = createUserToken({
        id: user.id,
        email: user.email,
        name: user.name,
        isAdmin: user.isAdmin,
        tokenVersion: user.tokenVersion,
      });

      return { token: authToken, user: sanitizeUser(user) };
    }
  );

  // Authenticated: an existing account (already logged in on this device,
  // or freshly created/logged-in via OIDC/password with this invite token)
  // joins the invite's group.
  fastify.post('/:token/accept', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const t = getT(request);
    const { token } = request.params as { token: string };
    const { invite, reason } = await getValidInvite(token);

    const failure = inviteFailureResponse(reason, t);
    if (failure) return reply.status(failure.status).send({ error: failure.error });

    if (invite!.email && invite!.email !== request.user!.email) {
      return reply.status(403).send({ error: t('errors.inviteEmailMismatch') });
    }

    await consumeInvite(token, request.user!.id);

    return { success: true, groupId: invite!.groupId };
  });
}
