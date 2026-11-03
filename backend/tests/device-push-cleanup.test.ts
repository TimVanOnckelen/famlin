import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { ServerSettings } from '../src/services/settings.js'
import { prisma } from '../src/db.js'
import { sendPush } from '../src/services/notificationChannels/push.js'
import { createUser } from './helpers.js'

const { sendPushNotificationsAsync } = vi.hoisted(() => ({ sendPushNotificationsAsync: vi.fn() }))

vi.mock('expo-server-sdk', () => ({
  Expo: class {
    static isExpoPushToken() {
      return true
    }

    chunkPushNotifications(messages: unknown[]) {
      return [messages]
    }

    sendPushNotificationsAsync = sendPushNotificationsAsync
  },
}))

describe('dead push-token device cleanup', () => {
  beforeAll(async () => {
    sendPushNotificationsAsync.mockResolvedValue([
      { status: 'error', details: { error: 'DeviceNotRegistered' }, message: 'Device is not registered' },
    ])
  })

  afterAll(() => {
    vi.restoreAllMocks()
  })

  it('deletes the stale token and its linked device when Expo rejects the token', async () => {
    const user = await createUser()
    const device = await prisma.device.create({
      data: {
        userId: user.id,
        installId: randomUUID(),
        platform: 'android',
        osVersion: '16',
        appVersion: '1.8.2',
        appBuild: '245',
        pushPermission: 'granted',
      },
    })
    const token = await prisma.pushToken.create({
      data: { userId: user.id, token: `ExponentPushToken[${randomUUID()}]`, deviceId: device.id },
    })

    await sendPush({
      type: 'new_post',
      recipients: [
        {
          id: user.id,
          email: user.email,
          emailOnNewPost: true,
          emailOnNewComment: true,
          emailOnNewLike: true,
          pushOnNewPost: true,
          pushOnNewComment: true,
          pushOnNewLike: true,
          pushOnChitchat: true,
          pushOnStory: true,
          pushOnGiftList: true,
        },
      ],
      message: 'New family post',
      settings: { defaultLanguage: 'en' } as ServerSettings,
      postId: null,
    })

    expect(sendPushNotificationsAsync).toHaveBeenCalledTimes(1)
    expect(await prisma.pushToken.findUnique({ where: { id: token.id } })).toBeNull()
    expect(await prisma.device.findUnique({ where: { id: device.id } })).toBeNull()
  })
})
