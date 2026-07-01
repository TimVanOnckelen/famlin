import React, { useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, SafeAreaView } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import * as Google from 'expo-auth-session/providers/google';
import Constants from 'expo-constants';

import { AppIcon } from '@/components/Logo';
import { Icon } from '@/components/Icon';
import { colors } from '@/constants/colors';
import { useAuthStore } from '@/stores/authStore';
import { loginWithGoogle, devLogin } from '@/api/auth';
import { FontAwesome } from '@expo/vector-icons';

WebBrowser.maybeCompleteAuthSession();

const GOOGLE_CLIENT_ID = Constants.expoConfig?.extra?.googleClientId || process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID || '';

if (__DEV__) {
  console.log('Google Client ID configured:', GOOGLE_CLIENT_ID ? 'yes' : 'NO — check EXPO_PUBLIC_GOOGLE_CLIENT_ID');
}

export function LoginScreen() {
  const { setAuth } = useAuthStore();

  const [request, response, promptAsync] = Google.useIdTokenAuthRequest({
    clientId: GOOGLE_CLIENT_ID,
  });

  const isConfigMissing = !GOOGLE_CLIENT_ID;

  useEffect(() => {
    if (response?.type === 'success') {
      const { id_token } = response.params;
      handleLogin(id_token);
    } else if (response?.type === 'error') {
      Alert.alert('Inloggen mislukt', response.error?.message || 'Probeer het opnieuw');
    }
  }, [response]);

  async function handleLogin(idToken: string) {
    try {
      const result = await loginWithGoogle(idToken);
      await setAuth(result.user, result.token);
    } catch (err: any) {
      Alert.alert('Inloggen mislukt', err.response?.data?.error || err.message || 'Probeer het opnieuw');
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <View style={styles.logoSection}>
          <AppIcon size={96} />
          <Text style={styles.title}>Famlin</Text>
          <Text style={styles.subtitle}>Jouw familie, dichterbij</Text>
        </View>

        <View style={styles.illustration}>
          <Text style={styles.illustrationLabel}>familie illustratie</Text>
        </View>

        {isConfigMissing && (
          <View style={styles.configWarning}>
            <Text style={styles.configWarningText}>
              Google Client ID ontbreekt. Controleer EXPO_PUBLIC_GOOGLE_CLIENT_ID in je .env of googleClientId in app.json.
            </Text>
          </View>
        )}

        <TouchableOpacity
          style={[styles.googleButton, (isConfigMissing || !request) && styles.googleButtonDisabled]}
          onPress={() => promptAsync()}
          disabled={isConfigMissing || !request}
        >
          <FontAwesome name="google" size={20} color={isConfigMissing ? colors.warmGray : colors.warmBlack} />
          <Text style={[styles.googleButtonText, isConfigMissing && styles.googleButtonTextDisabled]}>
            Inloggen met Google
          </Text>
        </TouchableOpacity>

        {__DEV__ && (
          <TouchableOpacity
            style={styles.devButton}
            onPress={async () => {
              try {
                const result = await devLogin();
                await setAuth(result.user, result.token);
              } catch (err: any) {
                Alert.alert('Dev login mislukt', err.response?.data?.error || err.message);
              }
            }}
          >
            <Text style={styles.devButtonText}>Dev login (admin@example.com)</Text>
          </TouchableOpacity>
        )}

        <Text style={styles.hint}>
          Enkel beschikbaar voor{'\n'}familieleden met een uitnodiging
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.cream,
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    paddingBottom: 48,
  },
  logoSection: {
    alignItems: 'center',
    marginBottom: 40,
  },
  title: {
    fontFamily: 'Nunito_900Black',
    fontSize: 40,
    color: colors.coral,
    letterSpacing: -2,
    marginTop: 16,
  },
  subtitle: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 17,
    color: colors.warmGray,
    marginTop: 8,
  },
  illustration: {
    width: 230,
    height: 140,
    borderRadius: 22,
    backgroundColor: colors.creamDark,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 52,
    borderWidth: 1,
    borderColor: colors.lightGray,
  },
  illustrationLabel: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 11,
    color: colors.warmGray,
    backgroundColor: colors.white,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
  },
  configWarning: {
    backgroundColor: '#FFF3E6',
    borderWidth: 1,
    borderColor: colors.amber,
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
    width: '100%',
  },
  configWarningText: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 13,
    color: colors.warmBlack,
    textAlign: 'center',
    lineHeight: 19,
  },
  googleButton: {
    width: '100%',
    height: 56,
    borderRadius: 100,
    borderWidth: 1.5,
    borderColor: colors.lightGray,
    backgroundColor: colors.white,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 14,
    elevation: 3,
    marginBottom: 20,
  },
  googleButtonDisabled: {
    backgroundColor: colors.cream,
    shadowOpacity: 0,
    elevation: 0,
  },
  googleButtonText: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 17,
    color: colors.warmBlack,
  },
  googleButtonTextDisabled: {
    color: colors.warmGray,
  },
  devButton: {
    width: '100%',
    height: 48,
    borderRadius: 100,
    borderWidth: 1.5,
    borderColor: colors.coral,
    backgroundColor: 'rgba(217, 106, 94, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  devButtonText: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 15,
    color: colors.coral,
  },
  hint: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 13,
    color: colors.warmGray,
    textAlign: 'center',
    lineHeight: 20,
  },
});
