import React, { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useFonts, Nunito_400Regular, Nunito_600SemiBold, Nunito_700Bold, Nunito_800ExtraBold, Nunito_900Black } from '@expo-google-fonts/nunito';

import { useAuthStore } from '@/stores/authStore';
import { LoginScreen } from '@/screens/LoginScreen';
import { MainTabs } from '@/navigation/MainTabs';
import { PostDetailScreen } from '@/screens/PostDetailScreen';
import { NewPostScreen } from '@/screens/NewPostScreen';
import { NotificationsScreen } from '@/screens/NotificationsScreen';
import { colors } from '@/constants/colors';
import { ActivityIndicator, View } from 'react-native';
import { api } from '@/api/client';
import { fetchMe } from '@/api/auth';
import { usePushNotifications } from '@/hooks/usePushNotifications';

const Stack = createNativeStackNavigator();
const queryClient = new QueryClient();

function AppContent() {
  const { user, setAuth, logout, isLoading, loadToken } = useAuthStore();
  const [initializing, setInitializing] = useState(true);

  let [fontsLoaded] = useFonts({
    Nunito_400Regular,
    Nunito_600SemiBold,
    Nunito_700Bold,
    Nunito_800ExtraBold,
    Nunito_900Black,
  });

  usePushNotifications();

  useEffect(() => {
    async function bootstrap() {
      try {
        const token = await loadToken();
        if (token) {
          const me = await fetchMe();
          await setAuth(me, token);
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
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.cream }}>
        <ActivityIndicator size="large" color={colors.coral} />
      </View>
    );
  }

  return (
    <NavigationContainer>
      <StatusBar style="dark" />
      <Stack.Navigator
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.cream },
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
