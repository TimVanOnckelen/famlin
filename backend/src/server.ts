import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import staticPlugin from '@fastify/static';
import path from 'path';
import fs from 'fs/promises';
import authPlugin from './plugins/auth.js';
import { config } from './config.js';

import authRoutes from './routes/auth.js';
import groupRoutes from './routes/groups.js';
import postRoutes from './routes/posts.js';
import commentRoutes from './routes/comments.js';
import likeRoutes from './routes/likes.js';
import pushTokenRoutes from './routes/push-tokens.js';
import notificationRoutes from './routes/notifications.js';
import immichRoutes from './routes/immich.js';
import uploadRoutes from './routes/uploads.js';

const fastify = Fastify({
  logger: {
    level: config.NODE_ENV === 'development' ? 'debug' : 'info',
  },
});

const uploadsDir = path.join(process.cwd(), 'uploads');

async function start() {
  await fs.mkdir(uploadsDir, { recursive: true });

  await fastify.register(cors, {
    origin: true,
    credentials: true,
  });

  await fastify.register(multipart, {
    limits: {
      fileSize: 20 * 1024 * 1024, // 20MB
      files: 10,
    },
  });

  await fastify.register(staticPlugin, {
    root: uploadsDir,
    prefix: '/uploads/',
  });

  await fastify.register(authPlugin);

  await fastify.register(authRoutes, { prefix: '/api/auth' });
  await fastify.register(groupRoutes, { prefix: '/api/groups' });
  await fastify.register(postRoutes, { prefix: '/api/posts' });
  await fastify.register(commentRoutes, { prefix: '/api' });
  await fastify.register(likeRoutes, { prefix: '/api' });
  await fastify.register(pushTokenRoutes, { prefix: '/api/push-tokens' });
  await fastify.register(notificationRoutes, { prefix: '/api/notifications' });
  await fastify.register(immichRoutes, { prefix: '/api/immich' });
  await fastify.register(uploadRoutes, { prefix: '/api/uploads' });

  fastify.get('/health', async () => ({ status: 'ok' }));

  try {
    const port = Number(config.PORT);
    await fastify.listen({ port, host: '0.0.0.0' });
    fastify.log.info(`Famlin backend running on port ${port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

start();
