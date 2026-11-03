import { api } from './client'

export type DevicePlatform = 'ios' | 'android'
export type PushPermission = 'granted' | 'denied' | 'undetermined'

export interface DevicePayload {
  platform: DevicePlatform
  osVersion: string
  appVersion: string
  appBuild: string
  pushPermission: PushPermission
}

export interface MemberDevice extends DevicePayload {
  installId: string
}

export async function reportDevice(installId: string, payload: DevicePayload): Promise<void> {
  await api.put(`/devices/${encodeURIComponent(installId)}`, payload)
}

export async function unregisterDevice(installId: string): Promise<void> {
  await api.delete(`/devices/${encodeURIComponent(installId)}`)
}

export async function fetchMyDevices(): Promise<MemberDevice[]> {
  const { data } = await api.get<MemberDevice[]>('/devices/me')
  return data
}
