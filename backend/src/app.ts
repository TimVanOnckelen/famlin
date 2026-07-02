import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import multipart from '@fastify/multipart';
import staticPlugin from '@fastify/static';
import path from 'path';
import fs from 'fs/promises';
import { ZodError } from 'zod';
import authPlugin, { verifyToken, verifyMediaToken, isSessionCurrent } from './plugins/auth.js';
import { config } from './config.js';
import { getT } from './i18n/index.js';

import authRoutes from './routes/auth.js';
import adminRoutes from './routes/admin.js';
import groupRoutes from './routes/groups.js';
import postRoutes from './routes/posts.js';
import commentRoutes from './routes/comments.js';
import likeRoutes from './routes/likes.js';
import favoriteRoutes from './routes/favorites.js';
import pushTokenRoutes from './routes/push-tokens.js';
import notificationRoutes from './routes/notifications.js';
import uploadRoutes from './routes/uploads.js';
import inviteRoutes from './routes/invites.js';
import inviteLandingRoutes from './routes/invite-landing.js';
import landingRoutes from './routes/landing.js';

// Builds and registers everything on a Fastify instance without starting the
// listener, so tests can exercise routes via `.inject()` against the exact
// same plugin/route wiring the real server uses.
export async function buildApp() {
  const fastify = Fastify({
    trustProxy: config.TRUST_PROXY,
    logger: {
      level: config.NODE_ENV === 'test' ? 'silent' : config.NODE_ENV === 'development' ? 'debug' : 'info',
    },
  });

  fastify.setErrorHandler((error, request, reply) => {
    const t = getT(request);

    if (error instanceof ZodError) {
      return reply.status(400).send({ error: t('errors.validationFailed'), details: error.flatten() });
    }

    // Client errors raised by Fastify itself or plugins (bad JSON, payload too
    // large, rate limit exceeded, ...) already carry a safe, specific message.
    if (error.statusCode && error.statusCode < 500) {
      return reply.status(error.statusCode).send({ error: error.message });
    }

    fastify.log.error(error);
    return reply.status(500).send({ error: t('errors.serverError') });
  });

  const uploadsDir = path.join(process.cwd(), 'uploads');
  await fs.mkdir(uploadsDir, { recursive: true });

  // The invite landing page and admin SPA render their own inline
  // styles/scripts, so a strict default CSP would break them; the rest of
  // helmet's headers (X-Content-Type-Options, frame-ancestors, HSTS, ...)
  // still apply.
  await fastify.register(helmet, {
    contentSecurityPolicy: false,
  });

  await fastify.register(rateLimit, {
    max: 300,
    timeWindow: '1 minute',
  });

  // Auth is bearer-token (Authorization header), never cookies, so there's
  // nothing for `credentials` to protect — leaving it off avoids opting every
  // reflected origin into credentialed requests for no benefit.
  await fastify.register(cors, {
    origin: true,
    credentials: false,
  });

  await fastify.register(multipart, {
    limits: {
      fileSize: 200 * 1024 * 1024, // 200MB (video posts need more headroom than photos)
      files: 10,
    },
  });

  // Uploaded photos/videos are family content, not public — require either a
  // normal session token (header) or a scoped media token (query string, see
  // routes/uploads.ts) before @fastify/static serves the file below.
  fastify.addHook('onRequest', async (request, reply) => {
    if (!request.raw.url?.startsWith('/uploads/')) return;

    const authHeader = request.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      try {
        const decoded = verifyToken(authHeader.slice(7));
        // Signature/expiry alone isn't enough — confirm the token still maps
        // to an active user at its issued tokenVersion, so a deactivated user
        // or a pre-password-reset token can't keep reading family media.
        if (await isSessionCurrent(decoded)) return;
      } catch {
        // fall through to the media-token check below
      }
    }

    const queryToken = (request.query as { token?: string } | undefined)?.token;
    if (queryToken) {
      const decoded = verifyMediaToken(queryToken);
      if (decoded && (await isSessionCurrent(decoded))) return;
    }

    return reply.status(401).send({ error: 'Unauthorized' });
  });

  await fastify.register(staticPlugin, {
    root: uploadsDir,
    prefix: '/uploads/',
  });

  await fastify.register(authPlugin);

  await fastify.register(authRoutes, { prefix: '/api/auth' });
  await fastify.register(adminRoutes, { prefix: '/api/admin' });
  await fastify.register(groupRoutes, { prefix: '/api/groups' });
  await fastify.register(postRoutes, { prefix: '/api/posts' });
  await fastify.register(commentRoutes, { prefix: '/api' });
  await fastify.register(likeRoutes, { prefix: '/api' });
  await fastify.register(favoriteRoutes, { prefix: '/api' });
  await fastify.register(pushTokenRoutes, { prefix: '/api/push-tokens' });
  await fastify.register(notificationRoutes, { prefix: '/api/notifications' });
  await fastify.register(uploadRoutes, { prefix: '/api/uploads' });
  await fastify.register(inviteRoutes, { prefix: '/api/invites' });
  await fastify.register(inviteLandingRoutes);
  await fastify.register(landingRoutes);

  // Serve admin web UI static build (if present)
  const adminDir = path.join(process.cwd(), 'dist', 'admin');
  try {
    await fs.access(adminDir);
    // wildcard: true (default) resolves each request against the filesystem
    // live, instead of registering a fixed route per file found at boot —
    // required so newly built assets (e.g. from `vite build --watch` in dev)
    // are served without restarting the backend process.
    await fastify.register(staticPlugin, {
      root: adminDir,
      prefix: '/admin/',
      decorateReply: false,
    });

    fastify.get('/admin', async (_request, reply) => {
      return reply.sendFile('index.html', adminDir);
    });

    // Anything under /admin that isn't a real static file is a client-side
    // route (or a stale reference to a since-rebuilt asset) — fall back to
    // index.html so the SPA router can take over.
    fastify.setNotFoundHandler((request, reply) => {
      if (request.raw.url?.startsWith('/admin/')) {
        return reply.sendFile('index.html', adminDir);
      }
      return reply.status(404).send({ error: 'Not found' });
    });

    fastify.log.info('Admin UI served at /admin');
  } catch {
    fastify.log.info('Admin UI build not found, skipping /admin serving');
  }

  fastify.get('/health', async () => ({ status: 'ok' }));

  return fastify;
}
