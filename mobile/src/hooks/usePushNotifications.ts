import { useEffect } from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { api } from '@/api/client';
import { fetchNotificationConfig } from '@/api/auth';
import { setPushToken } from '@/utils/storage';
import { useAuthStore } from '@/stores/authStore';
import { navigate } from '@/navigation/navigationRef';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

export function usePushNotifications() {
  // Registration needs an authenticated request (POST /push-tokens) and a
  // resolved API base URL, neither of which is guaranteed at first mount —
  // wait for the user to be loaded (bootstrap fetchMe or login) and re-run
  // whenever the signed-in user changes.
  const userId = useAuthStore((state) => state.user?.id);

  useEffect(() => {
    if (Platform.OS === 'web' || !userId) {
      return;
    }
    registerPushTokenAsync();
  }, [userId]);

  useEffect(() => {
    if (Platform.OS === 'web') return;

    function handleResponse(response: Notifications.NotificationResponse) {
      const data = response.notification.request.content.data as { relatedPostId?: string } | undefined;
      if (data?.relatedPostId) {
        navigate('PostDetail', { postId: data.relatedPostId });
      }
    }

    // Cold start: the app was launched by tapping a notification, so there's
    // no "tap" event to listen for — check whether that's how we got here.
    Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response) handleResponse(response);
    });

    const subscription = Notifications.addNotificationResponseReceivedListener(handleResponse);
    return () => subscription.remove();
  }, []);
}

async function registerPushTokenAsync() {
  if (!Device.isDevice) {
    console.log('Push notifications require a physical device');
    return;
  }

  try {
    const { pushEnabled } = await fetchNotificationConfig();
    if (!pushEnabled) {
      console.log('Push notifications are disabled on this server');
      return;
    }
  } catch (err) {
    console.error('Failed to fetch notification config', err);
    return;
  }

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'default',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') {
    console.log('Push notification permission not granted');
    return;
  }

  try {
    const tokenData = await Notifications.getExpoPushTokenAsync();
    const token = tokenData.data;

    await api.post('/push-tokens', { token });
    await setPushToken(token);
  } catch (err) {
    console.error('Failed to register push token', err);
  }
}
