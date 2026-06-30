import fp from 'fastify-plugin';
import { FastifyInstance, FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import jwt from 'jsonwebtoken';
import { OAuth2Client } from 'google-auth-library';
import { config } from '../config.js';
import { prisma } from '../db.js';

const googleClient = new OAuth2Client(config.GOOGLE_CLIENT_ID);

export interface AuthenticatedRequest extends FastifyRequest {
  user: {
    id: string;
    email: string;
    name: string;
    isAdmin: boolean;
  };
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthenticatedRequest['user'];
  }
}

export async function verifyGoogleToken(idToken: string) {
  const ticket = await googleClient.verifyIdToken({
    idToken,
    audience: config.GOOGLE_CLIENT_ID,
  });

  const payload = ticket.getPayload();
  if (!payload) {
    throw new Error('Invalid Google token');
  }

  const email = payload.email?.toLowerCase();
  if (!email) {
    throw new Error('Google account has no email');
  }

  if (!config.ALLOWED_EMAILS.includes(email)) {
    throw new Error('Email not allowed');
  }

  return {
    email,
    name: payload.name || email.split('@')[0],
    picture: payload.picture,
  };
}

export function createUserToken(user: { id: string; email: string; name: string; isAdmin: boolean }) {
  return jwt.sign(
    { id: user.id, email: user.email, name: user.name, isAdmin: user.isAdmin },
    config.JWT_SECRET,
    { expiresIn: '30d' }
  );
}

export function verifyToken(token: string) {
  return jwt.verify(token, config.JWT_SECRET) as AuthenticatedRequest['user'];
}

const authPlugin: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  fastify.decorate('authenticate', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const authHeader = request.headers.authorization;
      if (!authHeader?.startsWith('Bearer ')) {
        return reply.status(401).send({ error: 'Missing or invalid authorization header' });
      }

      const token = authHeader.slice(7);
      const decoded = verifyToken(token);

      const user = await prisma.user.findUnique({
        where: { id: decoded.id },
        select: { id: true, email: true, name: true, isAdmin: true },
      });

      if (!user) {
        return reply.status(401).send({ error: 'User not found' });
      }

      request.user = user;
    } catch (err) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }
  });
};

export default fp(authPlugin);
