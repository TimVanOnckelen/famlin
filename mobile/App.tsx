import React, { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useFonts, Nunito_400Regular, Nunito_600SemiBold, Nunito_700Bold, Nunito_800ExtraBold, Nunito_900Black } from '@expo-google-fonts/nunito';
import * as ScreenOrientation from 'expo-screen-orientation';
import * as Linking from 'expo-linking';

import '@/i18n';
import { initI18nLanguage } from '@/i18n';
import { useAuthStore } from '@/stores/authStore';
import { LoginScreen } from '@/screens/LoginScreen';
import { InviteScreen } from '@/screens/InviteScreen';
import { MainTabs } from '@/navigation/MainTabs';
import { PostDetailScreen } from '@/screens/PostDetailScreen';
import { NewPostScreen } from '@/screens/NewPostScreen';
import { NotificationsScreen } from '@/screens/NotificationsScreen';
import { FavoritesScreen } from '@/screens/FavoritesScreen';
import { GroupMembersScreen } from '@/screens/GroupMembersScreen';
import { ImageViewerScreen } from '@/screens/ImageViewerScreen';
import { colors } from '@/constants/colors';
import { ActivityIndicator, View } from 'react-native';
import { initApiBaseUrl, setUnauthorizedHandler } from '@/api/client';
import { fetchMe } from '@/api/auth';
import { usePushNotifications } from '@/hooks/usePushNotifications';
import { getServerUrl } from '@/utils/storage';

const Stack = createNativeStackNavigator();
const queryClient = new QueryClient();

// Parses `famlin://invite/<token>?server=<url>` (from the /invite/:token web
// landing page's "Open in the app" button). Returns null for any other URL.
function parseInviteUrl(url: string): { token: string; server?: string } | null {
  try {
    const { hostname, path, queryParams } = Linking.parse(url);
    const server = typeof queryParams?.server === 'string' ? queryParams.server : undefined;
    const rawToken = hostname === 'invite' ? path : path?.startsWith('invite/') ? path.slice('invite/'.length) : null;
    const token = rawToken?.replace(/^\//, '');
    return token ? { token, server } : null;
  } catch {
    return null;
  }
}

function AppContent() {
  const { user, setAuth, logout, clearSession, isLoading, loadToken } = useAuthStore();
  const [initializing, setInitializing] = useState(true);
  const [pendingInvite, setPendingInvite] = useState<{ token: string; server?: string } | null>(null);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      clearSession();
    });
  }, [clearSession]);

  let [fontsLoaded] = useFonts({
    Nunito_400Regular,
    Nunito_600SemiBold,
    Nunito_700Bold,
    Nunito_800ExtraBold,
    Nunito_900Black,
  });

  usePushNotifications();

  useEffect(() => {
    // The rest of the app is built for portrait only; the fullscreen media
    // viewer is the one screen that opts into free rotation on its own.
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
  }, []);

  useEffect(() => {
    function handleUrl(url: string) {
      const invite = parseInviteUrl(url);
      if (invite) setPendingInvite(invite);
    }
    Linking.getInitialURL().then((url) => {
      if (url) handleUrl(url);
    });
    const subscription = Linking.addEventListener('url', ({ url }) => handleUrl(url));
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    async function bootstrap() {
      try {
        await initI18nLanguage();
        await initApiBaseUrl();
        const token = await loadToken();
        if (token) {
          const me = await fetchMe();
          const serverUrl = await getServerUrl() || '';
          await setAuth(me, token, serverUrl);
        }
      } catch (err) {
        await logout();
      } finally {
        setInitializing(false);
      }
    }
    bootstrap();
  }, []);

  if (!fontsLoaded || initializing || isLoading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.bg }}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  // A pending invite link takes over the whole screen regardless of auth
  // state — it may log the user in (or register them) itself, at which
  // point `onDone` clears it and the normal Login/Main flow below takes over.
  if (pendingInvite) {
    return (
      <InviteScreen
        token={pendingInvite.token}
        server={pendingInvite.server}
        onDone={() => setPendingInvite(null)}
      />
    );
  }

  return (
    <NavigationContainer>
      <StatusBar style="dark" />
      <Stack.Navigator
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.bg },
        }}
      >
        {!user ? (
          <Stack.Screen name="Login" component={LoginScreen} />
        ) : (
          <>
            <Stack.Screen name="Main" component={MainTabs} />
            <Stack.Screen
              name="PostDetail"
              component={PostDetailScreen}
              options={{
                presentation: 'card',
                animation: 'slide_from_right',
              }}
            />
            <Stack.Screen
              name="NewPost"
              component={NewPostScreen}
              options={{
                presentation: 'modal',
                animation: 'slide_from_bottom',
              }}
            />
            <Stack.Screen
              name="Notifications"
              component={NotificationsScreen}
              options={{
                presentation: 'card',
                animation: 'slide_from_right',
              }}
            />
            <Stack.Screen
              name="Favorites"
              component={FavoritesScreen}
              options={{
                presentation: 'card',
                animation: 'slide_from_right',
              }}
            />
            <Stack.Screen
              name="GroupMembers"
              component={GroupMembersScreen}
              options={{
                presentation: 'card',
                animation: 'slide_from_right',
              }}
            />
            <Stack.Screen
              name="ImageViewer"
              component={ImageViewerScreen}
              options={{
                presentation: 'fullScreenModal',
                animation: 'fade',
              }}
            />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppContent />
    </QueryClientProvider>
  );
}
