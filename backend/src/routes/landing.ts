import { FastifyInstance } from 'fastify';
import { getSetting } from '../services/settings.js';
import i18n from '../i18n/index.js';
import { htmlPage } from '../utils/html-page.js';

export default async function landingRoutes(fastify: FastifyInstance) {
  fastify.get('/', async (_request, reply) => {
    const lang = await getSetting('defaultLanguage');
    const t = i18n.getFixedT(lang);

    reply.type('text/html');
    return htmlPage(
      lang,
      t('landing.pageTitle'),
      `<div class="status"><span class="status-dot"></span>${t('landing.status')}</div>
      <h1>${t('landing.title')}</h1>
      <p>${t('landing.body')}</p>`
    );
  });
}
