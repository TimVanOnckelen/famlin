import cron from 'node-cron';
import { buildApp } from './app.js';
import { config } from './config.js';
import { runOnThisDayJob } from './jobs/onThisDay.js';
import { runNewAssetsJob } from './jobs/newAssets.js';
import { runExpireStoriesJob } from './jobs/expireStories.js';

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

  // Hourly, offset from the top of the hour so it doesn't compete with other
  // scheduled work — surfaces newly-added assets on MANUAL/AUTO-mode linked
  // albums (see src/jobs/newAssets.ts).
  cron.schedule('15 * * * *', () => {
    runNewAssetsJob().catch((err) => fastify.log.error(err, 'new-assets job failed'));
  });

  // Every 10 minutes: deletes stories that expired without being pinned,
  // media included (see src/jobs/expireStories.ts). Also run once at boot so
  // a server that was down for a while doesn't keep expired media around
  // until the first tick.
  const expireStories = () =>
    runExpireStoriesJob().catch((err) => fastify.log.error(err, 'expire-stories job failed'));
  cron.schedule('*/10 * * * *', expireStories);
  expireStories();
}

start();
