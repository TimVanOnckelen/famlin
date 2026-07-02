import { buildApp } from './app.js';
import { config } from './config.js';

async function start() {
  const fastify = await buildApp();

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
