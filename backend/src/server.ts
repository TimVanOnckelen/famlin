import cron from 'node-cron';
import { buildApp } from './app.js';
import { config } from './config.js';
import { runOnThisDayJob } from './jobs/onThisDay.js';

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

  // Fixed daily time (server-local) rather than an admin-configurable
  // setting — kept simple for an MVP-scale feature.
  cron.schedule('0 8 * * *', () => {
    runOnThisDayJob().catch((err) => fastify.log.error(err, 'on-this-day job failed'));
  });
}

start();
