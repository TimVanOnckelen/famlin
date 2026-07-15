import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import multipart from '@fastify/multipart';
import staticPlugin from '@fastify/static';
import path from 'path';
import fs from 'fs/promises';
import { ZodError } from 'zod';
import authPlugin, { authenticateMediaRequest } from './plugins/auth.js';
import { config } from './config.js';
import { getT } from './i18n/index.js';
import { registerNotificationSubscriber } from './subscribers/notifications.js';

import authRoutes from './routes/auth.js';
import adminRoutes from './routes/admin.js';
import groupRoutes from './routes/groups.js';
import postRoutes from './routes/posts.js';
import commentRoutes from './routes/comments.js';
import likeRoutes from './routes/likes.js';
import favoriteRoutes from './routes/favorites.js';
import pushTokenRoutes from './routes/push-tokens.js';
import apiTokenRoutes from './routes/api-tokens.js';
import notificationRoutes from './routes/notifications.js';
import uploadRoutes from './routes/uploads.js';
import immichRoutes from './routes/immich.js';
import mediaRoutes from './routes/media.js';
import inviteRoutes from './routes/invites.js';
import inviteLandingRoutes from './routes/invite-landing.js';
import landingRoutes from './routes/landing.js';

// Builds and registers everything on a Fastify instance without starting the
// listener, so tests can exercise routes via `.inject()` against the exact
// same plugin/route wiring the real server uses.
export async function buildApp() {
  // Domain-event subscribers are registered here (not in server.ts) so tests
  // exercising routes via buildApp() get the same event->notification wiring
  // production has. Registration is idempotent — see the guard inside.
  registerNotificationSubscriber();

  const fastify = Fastify({
    trustProxy: config.TRUST_PROXY,
    logger: {
      level: config.NODE_ENV === 'test' ? 'silent' : config.NODE_ENV === 'development' ? 'debug' : 'info',
    },
  });

  // Rate limiting and client-IP logging key off request.ip, which only
  // reflects X-Forwarded-For when TRUST_PROXY is on. If a reverse proxy sits
  // in front of this server but TRUST_PROXY is left off, every request
  // resolves to the proxy's single IP — silently collapsing per-client rate
  // limits (login throttling, global cap) into one shared bucket. Warn once
  // so a misconfigured deployment doesn't fail silently.
  let loggedProxyHeaderMismatch = false;
  fastify.addHook('onRequest', async (request) => {
    if (!config.TRUST_PROXY && !loggedProxyHeaderMismatch && request.headers['x-forwarded-for']) {
      loggedProxyHeaderMismatch = true;
      fastify.log.warn(
        'Received an X-Forwarded-For header but TRUST_PROXY is not enabled. If this server sits behind a reverse proxy, every request will appear to come from the proxy\'s IP, collapsing rate limiting across all clients, and X-Forwarded-Proto/Host will be ignored so generated URLs (including OIDC redirect URIs) will use the raw connection scheme. Set TRUST_PROXY=true (only if that proxy is trusted to set these headers).'
      );
    }
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

  await fastify.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameAncestors: ["'self'"],
        formAction: ["'self'"],
        // 'unsafe-inline' + https: covers the invite/landing pages' inline
        // <style> blocks and the admin SPA's React inline style={{}} usage,
        // plus the Google Fonts stylesheet/font files it loads.
        styleSrc: ["'self'", 'https:', "'unsafe-inline'"],
        fontSrc: ["'self'", 'https:', 'data:'],
        // 'self' covers /uploads; https: covers OIDC-provided avatar
        // pictures, which are external URLs by nature (see routes/auth.ts).
        imgSrc: ["'self'", 'data:', 'https:'],
        // The admin SPA's OIDC login (LoginPage.tsx) does its PKCE code
        // exchange with a direct fetch() to the provider's token endpoint,
        // and that provider is whatever issuer the admin configures at
        // runtime — it can't be pinned to a fixed origin here.
        connectSrc: ["'self'", 'https:'],
      },
    },
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

    // Signature/expiry alone isn't enough — authenticateMediaRequest also
    // confirms the token still maps to an active user at its issued
    // tokenVersion, so a deactivated user or a pre-password-reset token can't
    // keep reading family media.
    if (await authenticateMediaRequest(request)) return;

    return reply.status(401).send({ error: getT(request)('errors.unauthorized') });
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
  await fastify.register(apiTokenRoutes, { prefix: '/api/api-tokens' });
  await fastify.register(notificationRoutes, { prefix: '/api/notifications' });
  await fastify.register(uploadRoutes, { prefix: '/api/uploads' });
  await fastify.register(immichRoutes, { prefix: '/api/immich' });
  await fastify.register(mediaRoutes, { prefix: '/api/media' });
  await fastify.register(inviteRoutes, { prefix: '/api/invites' });
  await fastify.register(inviteLandingRoutes);

  // Serve admin web UI static build (if present)
  const adminDir = path.join(process.cwd(), 'dist', 'admin');
  let adminServed = false;
  try {
    await fs.access(adminDir);
    adminServed = true;
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

    fastify.log.info('Admin UI served at /admin');
  } catch {
    fastify.log.info('Admin UI build not found, skipping /admin serving');
  }

  // Serve the member-facing web app build (if present) at / — same
  // single-container pattern as the admin UI above. When there is no web
  // build (e.g. local backend dev without running `npm run build:web`),
  // fall back to the original server-rendered landing page instead.
  const webDir = path.join(process.cwd(), 'dist', 'web');
  let webServed = false;
  try {
    // Check for index.html, not just the directory: the dev compose overlay
    // bind-mounts ./backend/dist/web, which creates an EMPTY directory on
    // first run if the host never built the web app — that must still fall
    // back to the landing page, not serve a 404 at /.
    await fs.access(path.join(webDir, 'index.html'));
    webServed = true;
    await fastify.register(staticPlugin, {
      root: webDir,
      prefix: '/',
      decorateReply: false,
    });

    fastify.get('/', async (_request, reply) => {
      return reply.sendFile('index.html', webDir);
    });

    fastify.log.info('Web app served at /');
  } catch {
    await fastify.register(landingRoutes);
    fastify.log.info('Web app build not found, serving landing page at /');
  }

  // Anything under /admin (or, when the web app is served, any GET that isn't
  // an API/uploads path) that doesn't match a real static file is a
  // client-side route (or a stale reference to a since-rebuilt asset) — fall
  // back to that SPA's index.html so its router can take over.
  fastify.setNotFoundHandler((request, reply) => {
    const url = request.raw.url ?? '';
    if (adminServed && url.startsWith('/admin/')) {
      return reply.sendFile('index.html', adminDir);
    }
    if (
      webServed &&
      request.method === 'GET' &&
      !url.startsWith('/api/') &&
      !url.startsWith('/uploads/') &&
      !url.startsWith('/admin')
    ) {
      return reply.sendFile('index.html', webDir);
    }
    return reply.status(404).send({ error: getT(request)('errors.notFound') });
  });

  fastify.get('/health', async () => ({ status: 'ok' }));

  return fastify;
}
