import { expect, test, type Page } from '@playwright/test'
import { ADMIN } from './accounts'

// The admin UI on a 360px-wide phone (issue #423): no admin page may scroll
// horizontally, navigation goes through the drawer, and dialogs are
// fullscreen sheets whose close button and primary action stay on screen.
// Runs as its own Playwright project (see playwright.config.ts) after the
// smoke suite, whose admin account and family it signs in with — once, since
// the login route is rate-limited.
test.describe.configure({ mode: 'serial' })

const ROUTES = [
  '/',
  '/getting-started',
  '/users',
  '/groups',
  '/content',
  '/push-log',
  '/devices',
  '/storage',
  '/status',
  '/settings',
]

let page: Page

async function settle() {
  await page.waitForLoadState('networkidle')
  await expect(page.locator('.loading')).toHaveCount(0)
}

async function expectNoHorizontalScroll(where: string) {
  const overflow = await page.evaluate(() => {
    const root = document.documentElement
    if (root.scrollWidth <= root.clientWidth) return null
    // Name the widest offenders so a failure says what to fix.
    const offenders = [...document.querySelectorAll('body *')]
      .filter((el) => el.getBoundingClientRect().right > root.clientWidth + 1)
      .slice(0, 5)
      .map((el) => `${el.tagName.toLowerCase()}.${[...el.classList].slice(0, 3).join('.')}`)
    return { scrollWidth: root.scrollWidth, clientWidth: root.clientWidth, offenders }
  })
  expect(overflow, `${where} scrolls horizontally at 360px`).toBeNull()
}

function inViewport(locator: ReturnType<Page['locator']>) {
  return locator.evaluate((el) => {
    const r = el.getBoundingClientRect()
    return r.top >= 0 && r.left >= 0 && r.bottom <= window.innerHeight && r.right <= window.innerWidth
  })
}

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage({ viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true })
})

test.afterAll(async () => {
  await page.close()
})

test('the admin login screen fits a phone', async () => {
  await page.goto('/admin/')
  await expect(page.locator('input[type="email"]')).toBeVisible()
  await expectNoHorizontalScroll('the login screen')

  await page.locator('input[type="email"]').fill(ADMIN.email)
  await page.locator('input[type="password"]').fill(ADMIN.password)
  await page.locator('button[type="submit"]').click()
  await expect(page.getByRole('button', { name: 'Open menu' })).toBeVisible()
})

test('no admin page scrolls horizontally', async () => {
  for (const route of ROUTES) {
    await page.goto(`/admin${route}`)
    await settle()
    await expectNoHorizontalScroll(route)
  }

  // Every tab and settings section, not just the one a page opens on.
  await page.goto('/admin/content')
  await settle()
  for (const tab of await page.getByRole('tab').all()) {
    await tab.click()
    await settle()
    await expectNoHorizontalScroll(`/content (${await tab.textContent()})`)
  }

  await page.goto('/admin/settings')
  await settle()
  for (const section of await page.locator('.settings-nav-item').all()) {
    await section.click()
    await settle()
    await expectNoHorizontalScroll(`/settings (${await section.textContent()})`)
  }
})

test('navigation goes through the drawer', async () => {
  await page.goto('/admin/')
  await settle()
  const menuButton = page.getByRole('button', { name: 'Open menu' })
  await expect(menuButton).toHaveAttribute('aria-expanded', 'false')
  await menuButton.click()

  const drawer = page.getByRole('dialog', { name: 'Menu' })
  await expect(drawer).toBeVisible()
  await drawer.getByRole('link', { name: 'Users' }).click()
  await expect(page).toHaveURL(/\/admin\/users$/)
  await expect(drawer).toBeHidden()

  // Esc closes it too, handing focus back to the menu button.
  await menuButton.click()
  await expect(drawer).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(drawer).toBeHidden()
  await expect(menuButton).toBeFocused()
})

test('dialogs are fullscreen sheets with their actions on screen', async () => {
  await page.goto('/admin/users')
  await settle()
  await page.getByRole('button', { name: 'Add member' }).click()

  const dialog = page.getByRole('dialog', { name: 'Add member' })
  await expect(dialog).toBeVisible()
  const box = await dialog.boundingBox()
  expect(box).toMatchObject({ x: 0, y: 0, width: 360, height: 740 })

  await dialog.getByRole('tab', { name: 'Create with password' }).click()
  expect(await inViewport(dialog.getByRole('button', { name: 'Close' }))).toBe(true)
  expect(await inViewport(dialog.getByRole('button', { name: 'Create user' }))).toBe(true)
  await expectNoHorizontalScroll('the Add member dialog')

  await dialog.getByRole('button', { name: 'Close' }).click()
  await expect(dialog).toBeHidden()
})
