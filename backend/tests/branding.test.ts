import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import fsp from 'fs/promises';
import path from 'path';
import sharp from 'sharp';
import { buildTestApp, createUser, authHeader } from './helpers.js';
import { prisma } from '../src/db.js';
import { uploadsDir } from '../src/config.js';
import { contrastRatio, hexToOklch, hueDistance } from '../src/services/branding/color.js';
import {
  BRAND_PRESETS,
  COLLISION_HUE_DISTANCE,
  DEFAULT_PALETTE,
  DEFAULT_SEMANTIC,
  MIN_CONTRAST,
  collidingFamilies,
  derivePalette,
} from '../src/services/branding/palette.js';
import { buildPublicBranding, resolveBrandSettings } from '../src/services/branding/index.js';
import { injectBrandingIntoHtml } from '../src/services/branding/css.js';
import { htmlPage } from '../src/utils/html-page.js';

function multipart(filename: string, contentType: string, data: Buffer) {
  const boundary = '----FamlinBrandingBoundary';
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
        `Content-Type: ${contentType}\r\n\r\n`
    ),
    data,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return { payload: body, headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

const pngLogo = () =>
  sharp({ create: { width: 800, height: 400, channels: 4, background: { r: 200, g: 40, b: 90, alpha: 1 } } })
    .png()
    .toBuffer();

describe('palette derivation', () => {
  it('teal returns today’s exact tokens, unshifted (pixel-identical upgrade)', () => {
    const derived = derivePalette(BRAND_PRESETS.teal);
    expect(derived.palette).toEqual(DEFAULT_PALETTE);
    expect(derived.semantic).toEqual(DEFAULT_SEMANTIC);
    expect(derived.adjusted).toBe(false);
    expect(derived.shifted).toEqual([]);
  });

  it('presets are pre-validated: none needs a contrast adjustment', () => {
    for (const [id, seed] of Object.entries(BRAND_PRESETS)) {
      const derived = derivePalette(seed);
      expect(derived.adjusted, id).toBe(false);
      expect(contrastRatio('#ffffff', derived.palette.primary), id).toBeGreaterThanOrEqual(MIN_CONTRAST);
    }
  });

  it('pins each preset’s collision behavior', () => {
    const shifts = Object.fromEntries(
      Object.entries(BRAND_PRESETS).map(([id, seed]) => [id, derivePalette(seed).shifted])
    );
    expect(shifts).toEqual({
      teal: [],
      ocean: [],
      indigo: [],
      plum: [],
      rose: [],
      coral: ['circle'],
      amber: ['milestone'],
      forest: [],
      slate: [],
    });
  });

  it('darkens a custom color that fails AA and reports the adjustment', () => {
    const derived = derivePalette('#f0c040');
    expect(derived.adjusted).toBe(true);
    expect(derived.palette.primary).not.toBe('#f0c040');
    expect(contrastRatio('#ffffff', derived.palette.primary)).toBeGreaterThanOrEqual(MIN_CONTRAST);
    // Darkening keeps the hue family.
    expect(hueDistance(hexToOklch(derived.palette.primary).h, hexToOklch('#f0c040').h)).toBeLessThan(10);
  });

  it('keeps an already-accessible custom color as-is', () => {
    const derived = derivePalette('#2F7A4B');
    expect(derived.adjusted).toBe(false);
    expect(derived.palette.primary).toBe('#2f7a4b');
  });

  it('shifts circle (and accent/updateBg with it) for a coral-ish brand', () => {
    const derived = derivePalette('#ff7f50');
    expect(derived.shifted).toEqual(['circle']);
    for (const token of ['accent', 'updateBg', 'circle', 'circleDark', 'circleTint'] as const) {
      expect(derived.semantic[token], token).not.toBe(DEFAULT_SEMANTIC[token]);
    }
    expect(derived.semantic.milestone).toBe(DEFAULT_SEMANTIC.milestone);
    expect(derived.semantic.trip).toBe(DEFAULT_SEMANTIC.trip);
    // The shifted circle is far from the brand, so a circle post can't look
    // like a normal family post.
    expect(
      hueDistance(hexToOklch(derived.semantic.circle).h, hexToOklch(derived.palette.primary).h)
    ).toBeGreaterThan(COLLISION_HUE_DISTANCE);
  });

  it('shifts milestone for a gold brand and trip for a non-teal blue brand', () => {
    expect(derivePalette('#e0a050').shifted).toEqual(['milestone']);
    const trip = derivePalette('#1f7fa3');
    expect(trip.shifted).toEqual(['trip']);
    expect(trip.semantic.trip).not.toBe(DEFAULT_SEMANTIC.trip);
  });

  it('shifts both circle and milestone for a brand between coral and gold', () => {
    // OKLCH hue ≈ 58°: within 25° of both coral (≈40°) and gold (≈75°).
    expect(collidingFamilies('#c06a10')).toEqual(['circle', 'milestone']);
    const derived = derivePalette('#c06a10');
    expect(derived.semantic.circle).not.toBe(DEFAULT_SEMANTIC.circle);
    expect(derived.semantic.milestone).not.toBe(DEFAULT_SEMANTIC.milestone);
  });

  it('never shifts for a gray brand (no hue to collide with)', () => {
    expect(derivePalette('#5a5a5a').shifted).toEqual([]);
  });

  it('is deterministic', () => {
    expect(derivePalette('#7b3f8c')).toEqual(derivePalette('#7B3F8C'));
  });
});

describe('branding resolution', () => {
  it('is null when nothing is set', () => {
    expect(buildPublicBranding(resolveBrandSettings({}))).toBeNull();
    expect(
      buildPublicBranding(resolveBrandSettings({ brandPreset: 'teal', brandColor: '', brandName: '', brandLogo: '' }))
    ).toBeNull();
  });

  it('falls back to teal for an unknown preset or a custom preset without a color', () => {
    expect(resolveBrandSettings({ brandPreset: 'neon' }).preset).toBe('teal');
    expect(resolveBrandSettings({ brandPreset: 'custom', brandColor: 'nope' }).preset).toBe('teal');
  });

  it('a name-only brand keeps the default palette', () => {
    const branding = buildPublicBranding(resolveBrandSettings({ brandName: 'The Janssens' }))!;
    expect(branding.name).toBe('The Janssens');
    expect(branding.palette).toEqual(DEFAULT_PALETTE);
    expect(branding.hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it('the hash changes with the brand', () => {
    const a = buildPublicBranding(resolveBrandSettings({ brandPreset: 'plum' }))!;
    const b = buildPublicBranding(resolveBrandSettings({ brandPreset: 'forest' }))!;
    expect(a.hash).not.toBe(b.hash);
  });

  it('injects escaped name, favicon and token overrides into index.html', () => {
    const branding = buildPublicBranding(
      resolveBrandSettings({ brandPreset: 'plum', brandName: '<script>x</script>', brandLogo: 'abcdef0123456789' })
    )!;
    const html = injectBrandingIntoHtml('<html><head><title>Famlin</title></head><body></body></html>', branding);
    expect(html).toContain('<title>&lt;script&gt;x&lt;/script&gt;</title>');
    expect(html).not.toContain('<script>x');
    expect(html).toContain(`--fam-primary:${branding.palette.primary}`);
    expect(html).toContain('href="/branding/favicon-abcdef0123456789.png"');
    expect(injectBrandingIntoHtml('<head></head>', null)).toBe('<head></head>');
  });

  it('server-rendered pages keep today’s look when unbranded', () => {
    const page = htmlPage('en', 'T', '<p>x</p>', null);
    expect(page).toContain('background: #edf7fb');
    expect(page).toContain('color: #006e94');
  });
});

describe('branding routes', () => {
  let app: FastifyInstance;
  let admin: Awaited<ReturnType<typeof createUser>>;
  let member: Awaited<ReturnType<typeof createUser>>;

  beforeAll(async () => {
    app = await buildTestApp();
    admin = await createUser({ isAdmin: true });
    member = await createUser();
  });

  afterAll(async () => {
    await fsp.rm(path.join(uploadsDir, 'branding'), { recursive: true, force: true });
    await app.close();
  });

  it('server-info carries branding: null on an unbranded server', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/auth/server-info' });
    expect(res.json().branding).toBeNull();
  });

  it('admin-only', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/branding', headers: authHeader(member) });
    expect(res.statusCode).toBe(403);
    const put = await app.inject({
      method: 'PUT',
      url: '/api/admin/branding',
      headers: authHeader(member),
      payload: { preset: 'plum', name: 'x' },
    });
    expect(put.statusCode).toBe(403);
  });

  it('previews without saving', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/branding/preview',
      headers: authHeader(admin),
      payload: { preset: 'custom', color: '#f0c040' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().adjusted).toBe(true);
    const info = await app.inject({ method: 'GET', url: '/api/auth/server-info' });
    expect(info.json().branding).toBeNull();
  });

  it('validates the preset and custom color', async () => {
    const unknown = await app.inject({
      method: 'PUT',
      url: '/api/admin/branding',
      headers: authHeader(admin),
      payload: { preset: 'neon', name: '' },
    });
    expect(unknown.statusCode).toBe(400);
    const missingColor = await app.inject({
      method: 'PUT',
      url: '/api/admin/branding',
      headers: authHeader(admin),
      payload: { preset: 'custom', name: '' },
    });
    expect(missingColor.statusCode).toBe(400);
    const longName = await app.inject({
      method: 'PUT',
      url: '/api/admin/branding',
      headers: authHeader(admin),
      payload: { preset: 'teal', name: 'x'.repeat(41) },
    });
    expect(longName.statusCode).toBe(400);
  });

  it('stores the admin’s custom input, derives the adjusted value at read time', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/admin/branding',
      headers: authHeader(admin),
      payload: { preset: 'custom', color: '#F0C040', name: '  The Janssens ' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.color).toBe('#f0c040');
    expect(body.name).toBe('The Janssens');
    expect(body.derived.adjusted).toBe(true);

    const row = await prisma.setting.findUnique({ where: { key: 'brandColor' } });
    expect(row?.value).toBe('#f0c040');

    const info = (await app.inject({ method: 'GET', url: '/api/auth/server-info' })).json();
    expect(info.branding.name).toBe('The Janssens');
    expect(info.branding.palette.primary).toBe(body.derived.palette.primary);
    expect(info.branding.semantic.milestone).not.toBe(DEFAULT_SEMANTIC.milestone);
  });

  it('cannot be set through the generic settings PATCH', async () => {
    await app.inject({
      method: 'PATCH',
      url: '/api/admin/settings',
      headers: authHeader(admin),
      payload: { brandName: 'Sneaky' },
    });
    const info = (await app.inject({ method: 'GET', url: '/api/auth/server-info' })).json();
    expect(info.branding.name).toBe('The Janssens');
  });

  it('uploads a logo, serves it publicly at /branding/* but not via /uploads/*', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/branding/logo',
      headers: { ...authHeader(admin), ...multipart('logo.png', 'image/png', await pngLogo()).headers },
      payload: multipart('logo.png', 'image/png', await pngLogo()).payload,
    });
    expect(res.statusCode).toBe(200);
    const { logoUrl, faviconUrl } = res.json();
    expect(logoUrl).toMatch(/^\/branding\/logo-[0-9a-f]{16}\.png$/);

    const logo = await app.inject({ method: 'GET', url: logoUrl });
    expect(logo.statusCode).toBe(200);
    expect(logo.headers['content-type']).toBe('image/png');
    expect(logo.headers['cache-control']).toContain('immutable');
    const meta = await sharp(logo.rawPayload).metadata();
    expect(Math.max(meta.width!, meta.height!)).toBeLessThanOrEqual(512);

    const favicon = await app.inject({ method: 'GET', url: faviconUrl });
    expect(favicon.statusCode).toBe(200);

    const viaUploads = await app.inject({
      method: 'GET',
      url: `/uploads${logoUrl}`,
      headers: authHeader(admin),
    });
    expect(viaUploads.statusCode).toBe(404);
    expect(await prisma.upload.count()).toBe(0);

    const info = (await app.inject({ method: 'GET', url: '/api/auth/server-info' })).json();
    expect(info.branding.logoUrl).toBe(logoUrl);
  });

  it('rejects SVG, non-images and oversized logos', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script></svg>');
    for (const [name, type, data] of [
      ['logo.svg', 'image/svg+xml', svg],
      ['logo.png', 'image/png', Buffer.from('not an image')],
      ['huge.png', 'image/png', Buffer.alloc(6 * 1024 * 1024, 1)],
    ] as const) {
      const body = multipart(name, type, data);
      const res = await app.inject({
        method: 'POST',
        url: '/api/admin/branding/logo',
        headers: { ...authHeader(admin), ...body.headers },
        payload: body.payload,
      });
      expect(res.statusCode, name).toBe(400);
    }
  });

  it('rejects path tricks on /branding/*', async () => {
    for (const url of ['/branding/..%2F..%2Fpackage.json', '/branding/logo.png', '/branding/logo-zzzz.png']) {
      expect((await app.inject({ method: 'GET', url })).statusCode, url).toBe(404);
    }
  });

  it('removes the logo and its files', async () => {
    const before = (await app.inject({ method: 'GET', url: '/api/admin/branding', headers: authHeader(admin) })).json();
    const res = await app.inject({ method: 'DELETE', url: '/api/admin/branding/logo', headers: authHeader(admin) });
    expect(res.statusCode).toBe(200);
    expect(res.json().logoUrl).toBeNull();
    expect((await app.inject({ method: 'GET', url: before.logoUrl })).statusCode).toBe(404);
  });

  it('brands the invite landing page', async () => {
    const res = await app.inject({ method: 'GET', url: '/invite/does-not-exist' });
    expect(res.body).toContain('The Janssens');
  });
});
