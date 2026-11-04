import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { prisma } from '../src/db.js'
import { emailChannel, notificationLink } from '../src/services/notificationChannels/email.js'
import type { Recipient } from '../src/services/notificationChannels/types.js'
import { getAllSettings, updateSettings } from '../src/services/settings.js'
import { authHeader, buildTestApp, createGroupWithMember, createPost, createUser } from './helpers.js'

const sendMail = vi.hoisted(() => vi.fn().mockResolvedValue({}))
vi.mock('nodemailer', () => ({ default: { createTransport: () => ({ sendMail }) } }))

const SMTP = { smtpHost: 'smtp.example.com', smtpUser: 'mailer', smtpPass: 'secret' }

function recipient(email: string): Recipient {
  return {
    id: 'r1',
    email,
    emailOnNewPost: true,
    emailOnNewComment: true,
    emailOnNewLike: true,
    pushOnNewPost: true,
    pushOnNewComment: true,
    pushOnNewLike: true,
    pushOnChitchat: true,
    pushOnStory: false,
    pushOnGiftList: true,
  }
}

describe('notificationLink', () => {
  it('returns null while publicUrl is unset', () => {
    expect(notificationLink('', { id: 'p1', type: 'UPDATE' }, 'new_post')).toBeNull()
    expect(notificationLink('   ', null, 'on_this_day')).toBeNull()
  })

  it('links a post to its permalink, and trips/albums/gift lists to their own pages', () => {
    const base = 'https://famlin.example.com/'
    expect(notificationLink(base, { id: 'p1', type: 'UPDATE' }, 'new_post')).toBe('https://famlin.example.com/posts/p1')
    expect(notificationLink(base, { id: 'p2', type: 'MILESTONE' }, 'new_comment')).toBe(
      'https://famlin.example.com/posts/p2'
    )
    expect(notificationLink(base, { id: 't1', type: 'TRIP' }, 'new_comment')).toBe(
      'https://famlin.example.com/trips/t1'
    )
    expect(notificationLink(base, { id: 'a1', type: 'ALBUM' }, 'new_like_post')).toBe(
      'https://famlin.example.com/albums/a1'
    )
    expect(notificationLink(base, { id: 'g1', type: 'GIFT_LIST' }, 'new_post')).toBe(
      'https://famlin.example.com/gift-lists/g1'
    )
  })

  it('falls back to the Photos tab for new album assets and the app root otherwise', () => {
    expect(notificationLink('https://famlin.example.com', null, 'new_media_assets')).toBe(
      'https://famlin.example.com/photos'
    )
    // A post that was deleted between the event and the send.
    expect(notificationLink('https://famlin.example.com', null, 'new_post')).toBe('https://famlin.example.com/')
  })
})

describe('notification emails', () => {
  beforeEach(() => {
    sendMail.mockClear()
  })

  it('carries no link while publicUrl is unset', async () => {
    const author = await createUser()
    const group = await createGroupWithMember(author)
    const post = await createPost({ groupId: group.id, authorId: author.id })
    await updateSettings({ ...SMTP, publicUrl: '' })

    await emailChannel.send({
      type: 'new_post',
      recipients: [recipient('a@example.com')],
      message: 'Grandma shared a post',
      settings: await getAllSettings(),
      postId: post.id,
    })

    expect(sendMail).toHaveBeenCalledTimes(1)
    const { text } = sendMail.mock.calls[0][0]
    expect(text).toContain('Grandma shared a post')
    expect(text).not.toContain('http')
  })

  it("links to the post's page in the web app once publicUrl is set", async () => {
    const author = await createUser()
    const group = await createGroupWithMember(author)
    const post = await createPost({ groupId: group.id, authorId: author.id })
    const trip = await prisma.post.create({
      data: { groupId: group.id, authorId: author.id, content: '', type: 'TRIP', typeData: { title: 'Rome' } },
    })
    await updateSettings({ ...SMTP, publicUrl: 'https://famlin.example.com/' })

    const settings = await getAllSettings()
    expect(settings.publicUrl).toBe('https://famlin.example.com')

    await emailChannel.send({
      type: 'new_post',
      recipients: [recipient('a@example.com'), recipient('b@example.com')],
      message: 'Grandma shared a post',
      settings,
      postId: post.id,
    })
    await emailChannel.send({
      type: 'new_comment',
      recipients: [recipient('a@example.com')],
      message: 'Grandpa commented',
      settings,
      postId: trip.id,
    })

    expect(sendMail).toHaveBeenCalledTimes(3)
    expect(sendMail.mock.calls[0][0].text).toContain(`https://famlin.example.com/posts/${post.id}`)
    expect(sendMail.mock.calls[1][0].text).toContain(`https://famlin.example.com/posts/${post.id}`)
    expect(sendMail.mock.calls[2][0].text).toContain(`https://famlin.example.com/trips/${trip.id}`)
  })
})

describe('PATCH /api/admin/settings publicUrl', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    app = await buildTestApp()
  })

  afterAll(async () => {
    await app.close()
  })

  async function patch(publicUrl: string) {
    const admin = await createUser({ isAdmin: true })
    return app.inject({
      method: 'PATCH',
      url: '/api/admin/settings',
      headers: authHeader(admin),
      payload: { publicUrl },
    })
  }

  it('stores an http(s) origin without its trailing slash, and clears it', async () => {
    const res = await patch('https://famlin.example.com:8443/')
    expect(res.statusCode).toBe(200)
    expect(res.json().publicUrl).toBe('https://famlin.example.com:8443')
    const row = await prisma.setting.findUnique({ where: { key: 'publicUrl' } })
    expect(row?.value).toBe('https://famlin.example.com:8443')

    const cleared = await patch('')
    expect(cleared.statusCode).toBe(200)
    expect(cleared.json().publicUrl).toBe('')
  })

  it.each(['not a url', 'ftp://famlin.example.com', 'https://famlin.example.com/famlin', 'https://x.example.com/?a=1'])(
    'rejects %s',
    async (value) => {
      const res = await patch(value)
      expect(res.statusCode).toBe(400)
    }
  )
})
