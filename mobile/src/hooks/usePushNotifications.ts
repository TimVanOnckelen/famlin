import { useEffect } from 'react'
import { AppState, Platform } from 'react-native'
import * as Notifications from 'expo-notifications'
import { AndroidImportance } from 'expo-notifications'
import * as Device from 'expo-device'
import { fetchNotificationConfig, registerPushToken } from '@famlin/api-client'
import { getPushToken, setPushToken } from '@/utils/storage'
import { useAuthStore } from '@/stores/authStore'
import { navigate } from '@/navigation/navigationRef'
import { getOrCreateDeviceInstallId, syncDeviceDiagnostics } from '@/utils/deviceDiagnostics'

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
})

export function usePushNotifications() {
  // Registration needs an authenticated request (POST /push-tokens) and a
  // resolved API base URL, neither of which is guaranteed at first mount —
  // wait for the user to be loaded (bootstrap fetchMe or login) and re-run
  // whenever the signed-in user changes.
  const userId = useAuthStore((state) => state.user?.id)

  useEffect(() => {
    if (Platform.OS === 'web' || !userId) {
      return
    }
    void registerPushTokenAsync(userId)
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void refreshDeviceDiagnostics(userId)
      }
    })
    return () => subscription.remove()
  }, [userId])

  useEffect(() => {
    if (Platform.OS === 'web') return

    function handleResponse(response: Notifications.NotificationResponse) {
      const data = response.notification.request.content.data as
        { relatedPostId?: string | null; relatedStoryId?: string | null } | undefined
      if (data?.relatedPostId) {
        navigate('PostDetail', { postId: data.relatedPostId })
      } else if (data?.relatedStoryId) {
        navigate('StoryViewer', { storyId: data.relatedStoryId })
      }
    }

    // Cold start: the app was launched by tapping a notification, so there's
    // no "tap" event to listen for — check whether that's how we got here.
    Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response) handleResponse(response)
    })

    const subscription = Notifications.addNotificationResponseReceivedListener(handleResponse)
    return () => subscription.remove()
  }, [])
}

async function registerPushTokenAsync(userId: string) {
  let installId: string
  try {
    installId = await getOrCreateDeviceInstallId()
    await syncDeviceDiagnostics(userId)
  } catch (err) {
    console.error('Failed to report device diagnostics', err)
    // Diagnostics are best-effort and must never prevent sign-in or push
    // registration from working.
    installId = await getOrCreateDeviceInstallId()
  }

  if (!Device.isDevice) {
    console.log('Push notifications require a physical device')
    return
  }

  try {
    const { pushEnabled } = await fetchNotificationConfig()
    if (!pushEnabled) {
      console.log('Push notifications are disabled on this server')
      return
    }
  } catch (err) {
    console.error('Failed to fetch notification config', err)
    return
  }

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'default',
      importance: AndroidImportance.DEFAULT,
    })
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync()
  let finalStatus = existingStatus

  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync()
    finalStatus = status
    await syncDeviceDiagnostics(userId).catch((err) => console.error('Failed to report device diagnostics', err))
  }

  if (finalStatus !== 'granted') {
    console.log('Push notification permission not granted')
    return
  }

  try {
    const tokenData = await Notifications.getExpoPushTokenAsync()
    const token = tokenData.data

    await registerPushToken(token, installId)
    await setPushToken(token)
  } catch (err) {
    console.error('Failed to register push token', err)
  }
}

async function refreshDeviceDiagnostics(userId: string) {
  try {
    const report = await syncDeviceDiagnostics(userId)
    if (!report?.changed) return

    // If the first diagnostics request failed but push registration succeeded,
    // link the already-registered token once the changed report creates the
    // Device row. This remains a field-change write, not a foreground heartbeat.
    const token = await getPushToken()
    if (token) await registerPushToken(token, report.installId)
  } catch (err) {
    console.error('Failed to report device diagnostics', err)
  }
}
