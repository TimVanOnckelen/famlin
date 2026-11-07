import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { fileURLToPath } from 'node:url'

// The golden path of a fresh install, in order: first-run admin setup, a
// family plus an invite, a member joining through it, a photo post, a
// comment and a reaction, and the admin seeing all of it. Each test builds
// on the state the previous one left behind, so the file runs serially.
test.describe.configure({ mode: 'serial' })

const PHOTO = fileURLToPath(new URL('./fixtures/photo.jpg', import.meta.url))
const ADMIN = { name: 'E2E Admin', email: 'admin@e2e.test', password: 'admin-password-123' }
const MEMBER = { name: 'E2E Member', email: 'member@e2e.test', password: 'member-password-123' }
const FAMILY = 'E2E Family'
const POST_TEXT = `Hello from the e2e smoke test ${Date.now()}`
const COMMENT_TEXT = 'What a lovely photo!'

let inviteToken = ''

async function apiLogin(request: APIRequestContext, email: string, password: string) {
  const res = await request.post('/api/auth/login', { data: { email, password } })
  expect(res.ok(), await res.text()).toBeTruthy()
  const { token, user } = (await res.json()) as { token: string; user: { id: string } }
  return { userId: user.id, headers: { Authorization: `Bearer ${token}` } }
}

async function webLogin(page: Page, email: string, password: string) {
  await page.goto('/')
  await page.locator('input[type="email"]').fill(email)
  await page.locator('input[type="password"]').fill(password)
  await page.locator('button[type="submit"]').click()
  // The app shell's composer button only exists once signed in.
  await expect(page.getByRole('button', { name: 'New post' }).first()).toBeVisible()
}

test('the server is healthy and serves the web app and the admin UI', async ({ request, page }) => {
  expect((await request.get('/health')).ok()).toBeTruthy()

  const status = await request.get('/api/auth/setup-status')
  expect(await status.json(), 'e2e tests need a fresh database').toMatchObject({ needsSetup: true })

  // SPA fallback: a deep link still gets the web app's index.html.
  const deepLink = await request.get('/posts/does-not-exist')
  expect(deepLink.ok()).toBeTruthy()
  expect(deepLink.headers()['content-type']).toContain('text/html')

  // Fail on any uncaught error in the browser, e.g. a broken bundle or CSP.
  const errors: string[] = []
  page.on('pageerror', (err) => errors.push(err.message))
  await page.goto('/')
  await expect(page.locator('input[type="email"]')).toBeVisible()
  expect(errors).toEqual([])
})

test('the first admin is created through the admin setup screen', async ({ page }) => {
  await page.goto('/admin/')
  const form = page.locator('form')
  await form.locator('input[type="text"]').fill(ADMIN.name)
  await form.locator('input[type="email"]').fill(ADMIN.email)
  const passwords = form.locator('input[type="password"]')
  await passwords.nth(0).fill(ADMIN.password)
  await passwords.nth(1).fill(ADMIN.password)
  await form.locator('button[type="submit"]').click()

  // A fresh (non-restore) setup lands on the first-run wizard.
  await expect(page).toHaveURL(/\/admin\/getting-started/)
})

test('the admin creates a family and an invite link', async ({ request }) => {
  const { userId: adminId, headers } = await apiLogin(request, ADMIN.email, ADMIN.password)

  const group = await request.post('/api/admin/groups', { headers, data: { name: FAMILY } })
  expect(group.ok(), await group.text()).toBeTruthy()
  const { id: groupId } = (await group.json()) as { id: string }

  const member = await request.post(`/api/admin/groups/${groupId}/members`, { headers, data: { userId: adminId } })
  expect(member.ok(), await member.text()).toBeTruthy()

  const invite = await request.post(`/api/admin/groups/${groupId}/invites`, { headers, data: {} })
  expect(invite.ok(), await invite.text()).toBeTruthy()
  const body = (await invite.json()) as { token: string; link: string }
  expect(body.link).toContain(`/invite/${body.token}`)
  inviteToken = body.token
})

test('the invite landing page renders for a visitor', async ({ page }) => {
  const res = await page.goto(`/invite/${inviteToken}`)
  expect(res?.ok()).toBeTruthy()
  await expect(page.getByText(FAMILY).first()).toBeVisible()
})

test('a new member registers through the invite in the web app', async ({ page }) => {
  await page.goto(`/join/${inviteToken}`)
  await expect(page.getByText(FAMILY).first()).toBeVisible()

  const form = page.locator('form.login-form')
  await form.locator('input[autocomplete="name"]').fill(MEMBER.name)
  await form.locator('input[type="email"]').fill(MEMBER.email)
  await form.locator('input[type="password"]').fill(MEMBER.password)
  await form.locator('button[type="submit"]').click()

  // Lands on the (still empty) family feed.
  await expect(page.getByText('No posts yet')).toBeVisible()
})

test('the member shares a post with a photo', async ({ page }) => {
  await webLogin(page, MEMBER.email, MEMBER.password)

  await page.getByRole('button', { name: 'New post' }).first().click()
  const modal = page.locator('form.modal-card')
  await expect(modal).toBeVisible()

  // With a single family the composer preselects it and hides the picker.
  const family = modal.getByRole('button', { name: FAMILY })
  if ((await family.count()) > 0 && (await family.getAttribute('aria-pressed')) !== 'true') await family.click()

  await modal.locator('textarea').fill(POST_TEXT)
  await modal.locator('input[type="file"]').setInputFiles(PHOTO)
  const submit = modal.locator('button[type="submit"]')
  // Enabled once the photo has finished uploading.
  await expect(submit).toBeEnabled()
  await submit.click()
  await expect(modal).toBeHidden()

  const card = page.getByRole('article').filter({ hasText: POST_TEXT })
  await expect(card).toBeVisible()

  // The photo is really served (auth-gated /uploads/ + the resized display
  // copy), not just an <img> pointing at a broken URL.
  const img = card.locator('img[src*="/uploads/"]').first()
  await expect(img).toBeVisible()
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true)
})

test('the member reacts to and comments on the post', async ({ page }) => {
  await webLogin(page, MEMBER.email, MEMBER.password)
  const card = page.getByRole('article').filter({ hasText: POST_TEXT })

  const react = card.locator('.reaction-wrap > .action-btn')
  await react.click()
  await expect(react).toHaveClass(/action-btn-active/)
  await expect(react).toContainText('1')

  // Opens the post detail modal with the full comment thread.
  await card.locator('.post-comments-btn').click()
  const input = page.locator('.comment-input')
  await input.fill(COMMENT_TEXT)
  await page.locator('.comment-send').click()
  await expect(page.getByText(COMMENT_TEXT)).toBeVisible()
  await expect(input).toHaveValue('')
})

test('the admin sees the post, the reaction and the comment', async ({ page }) => {
  await webLogin(page, ADMIN.email, ADMIN.password)
  const card = page.getByRole('article').filter({ hasText: POST_TEXT })
  await expect(card).toBeVisible()
  await expect(card).toContainText(MEMBER.name)
  await expect(card.locator('.reaction-wrap > .action-btn')).toContainText('1')
  await expect(card).toContainText('1 comment')
})

test('the member can download their own data export', async ({ request }) => {
  const { headers } = await apiLogin(request, MEMBER.email, MEMBER.password)
  const res = await request.get('/api/auth/me/export', { headers })
  expect(res.ok(), await res.text()).toBeTruthy()
  const zip = await res.body()
  // Zip local file header magic: "PK\x03\x04".
  expect(zip.subarray(0, 4).toString('hex')).toBe('504b0304')
})
