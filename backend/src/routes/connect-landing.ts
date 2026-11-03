import { FastifyInstance } from 'fastify'
import { getSetting } from '../services/settings.js'
import i18n from '../i18n/index.js'
import { escapeHtml, htmlPage } from '../utils/html-page.js'
import { getBranding } from '../services/branding/index.js'

// The page the "Connect the mobile app" QR code (admin dashboard, web
// profile — issue #345) points at. Scanned with the phone's own camera it
// opens here; the button hands the server address to the app via
// `famlin://connect?server=...`. Public and read-only: the origin is derived
// from the request exactly like the invite landing page.
export default async function connectLandingRoutes(fastify: FastifyInstance) {
  fastify.get('/connect', async (request, reply) => {
    const lang = await getSetting('defaultLanguage')
    const t = i18n.getFixedT(lang)
    const branding = await getBranding()

    // host, not hostname: only host carries the port on Fastify 5.
    const origin = `${request.protocol}://${request.host}`
    const appLink = `famlin://connect?server=${encodeURIComponent(origin)}`

    const [appStoreUrl, playStoreUrl] = await Promise.all([getSetting('appStoreUrl'), getSetting('playStoreUrl')])
    const storeLinks = [
      appStoreUrl && `<a class="store-button" href="${escapeHtml(appStoreUrl)}">${t('inviteLanding.appStore')}</a>`,
      playStoreUrl && `<a class="store-button" href="${escapeHtml(playStoreUrl)}">${t('inviteLanding.playStore')}</a>`,
    ].filter(Boolean)

    reply.type('text/html')
    return htmlPage(
      lang,
      t('connectLanding.pageTitle'),
      `<h1>${t('connectLanding.title')}</h1>
      <p>${t('connectLanding.subtitle')}</p>
      <a class="button" href="${escapeHtml(appLink)}">${t('connectLanding.openButton')}</a>
      ${storeLinks.length > 0 ? `<div class="store-links">${storeLinks.join('')}</div>` : ''}
      <p class="hint">${t('connectLanding.manualHint')}<br /><strong>${escapeHtml(origin)}</strong></p>`,
      branding
    )
  })
}
