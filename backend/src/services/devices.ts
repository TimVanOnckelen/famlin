import { prisma } from '../db.js'
import type { z } from 'zod'
import type { devicePayloadSchema } from '../types.js'

export const MAX_DEVICES_PER_USER = 20
export type DevicePayload = z.infer<typeof devicePayloadSchema>

export class DeviceLimitError extends Error {
  constructor() {
    super('deviceLimitReached')
    this.name = 'DeviceLimitError'
  }
}

function samePayload(
  device: Pick<DevicePayload, 'osVersion' | 'appVersion' | 'appBuild'> & { platform: string; pushPermission: string },
  payload: DevicePayload
): boolean {
  return (
    device.platform === payload.platform &&
    device.osVersion === payload.osVersion &&
    device.appVersion === payload.appVersion &&
    device.appBuild === payload.appBuild &&
    device.pushPermission === payload.pushPermission
  )
}

function isSerializationConflict(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2034'
}

export async function reportDevice(userId: string, installId: string, payload: DevicePayload) {
  // Serializable count-and-write prevents concurrent installs from exceeding
  // the per-user cap. Retry PostgreSQL serialization conflicts a few times.
  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          const existing = await tx.device.findUnique({ where: { installId } })
          if (existing?.userId === userId && samePayload(existing, payload)) {
            return { device: existing, changed: false }
          }

          if (!existing || existing.userId !== userId) {
            const count = await tx.device.count({ where: { userId } })
            if (count >= MAX_DEVICES_PER_USER) throw new DeviceLimitError()
          }

          if (!existing) {
            const device = await tx.device.create({ data: { userId, installId, ...payload } })
            return { device, changed: true }
          }

          // An install id is a binding key, not proof of identity. On a shared
          // device/account switch, discard the previous account's linked push
          // tokens so notifications cannot continue reaching that installation.
          if (existing.userId !== userId) {
            await tx.pushToken.deleteMany({ where: { deviceId: existing.id } })
          }
          const device = await tx.device.update({ where: { installId }, data: { userId, ...payload } })
          return { device, changed: true }
        },
        { isolationLevel: 'Serializable' }
      )
    } catch (error) {
      if (isSerializationConflict(error) && attempt < 2) continue
      throw error
    }
  }
}
