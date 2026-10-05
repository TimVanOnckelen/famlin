import { FastifyInstance } from 'fastify';
import { getValidInvite } from '../services/invites.js';
import { getSetting } from '../services/settings.js';
import i18n from '../i18n/index.js';
import { escapeHtml, htmlPage } from '../utils/html-page.js';
import { getBranding } from '../services/branding/index.js';

export default async function inviteLandingRoutes(fastify: FastifyInstance) {
  fastify.get('/invite/:token', async (request, reply) => {
    const { token } = request.params as { token: string };
    const lang = await getSetting('defaultLanguage');
    const t = i18n.getFixedT(lang);
    // Fully branded (issue #164): this is the page people see in a chat
    // link preview, so it carries the family's name, logo and colors.
    const branding = await getBranding();
    const page = (l: typeof lang, title: string, body: string) => htmlPage(l, title, body, branding);

    const { invite, reason } = await getValidInvite(token);

    if (!invite) {
      reply.type('text/html');
      return page(
        lang,
        t('inviteLanding.notFoundTitle'),
        `<h1>${t('inviteLanding.notFoundTitle')}</h1><p>${t('inviteLanding.notFoundBody')}</p>`
      );
    }

    if (reason === 'expired') {
      reply.type('text/html');
      return page(
        lang,
        t('inviteLanding.expiredTitle'),
        `<h1>${t('inviteLanding.expiredTitle')}</h1><p>${t('inviteLanding.expiredBody')}</p>`
      );
    }

    if (reason === 'used') {
      reply.type('text/html');
      return page(
        lang,
        t('inviteLanding.usedTitle'),
        `<h1>${t('inviteLanding.usedTitle')}</h1><p>${t('inviteLanding.usedBody')}</p>`
      );
    }

    // request.protocol/host already resolve X-Forwarded-Proto/Host correctly
    // when TRUST_PROXY is enabled (see app.ts) — otherwise they reflect the raw
    // connection, so a client can't spoof the origin baked into this link.
    // host, not hostname: only host carries the port on Fastify 5, and this
    // origin is what the app will talk to.
    const origin = `${request.protocol}://${request.host}`;
    const appLink = `famlin://invite/${token}?server=${encodeURIComponent(origin)}`;

    const inviterName = invite.createdBy?.name;
    const groupName = escapeHtml(invite.group.name);
    const intro = inviterName
      ? t('inviteLanding.invitedByTitle', { inviter: escapeHtml(inviterName), group: groupName })
      : t('inviteLanding.invitedTitle', { group: groupName });

    const [appStoreUrl, playStoreUrl] = await Promise.all([
      getSetting('appStoreUrl'),
      getSetting('playStoreUrl'),
    ]);

    const storeLinks = [
      appStoreUrl && `<a class="store-button" href="${escapeHtml(appStoreUrl)}">${t('inviteLanding.appStore')}</a>`,
      playStoreUrl && `<a class="store-button" href="${escapeHtml(playStoreUrl)}">${t('inviteLanding.playStore')}</a>`,
    ].filter(Boolean);

    reply.type('text/html');
    return page(
      lang,
      branding?.name
        ? t('inviteLanding.pageTitleBranded', { group: invite.group.name, name: branding.name })
        : t('inviteLanding.pageTitle', { group: invite.group.name }),
      `<h1>${intro}</h1>
      <p>${t('inviteLanding.subtitle')}</p>
      <a class="button" href="${appLink}">${t('inviteLanding.openButton')}</a>
      ${storeLinks.length > 0 ? `<div class="store-links">${storeLinks.join('')}</div>` : ''}
      <p class="hint">${storeLinks.length > 0 ? t('inviteLanding.hintWithStores') : t('inviteLanding.hint')}</p>`
    );
  });
}
