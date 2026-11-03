import { api } from './client'

export async function registerPushToken(token: string, installId?: string): Promise<void> {
  await api.post('/push-tokens', { token, installId })
}

export async function unregisterPushToken(token: string): Promise<void> {
  await api.delete('/push-tokens', { params: { token } })
}
