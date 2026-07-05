import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, TextInput, ScrollView, KeyboardAvoidingView, Platform, Animated } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as WebBrowser from 'expo-web-browser';
import { useTranslation } from 'react-i18next';

import { AppIcon } from '@/components/Logo';
import { colors } from '@/constants/colors';
import { useAuthStore } from '@/stores/authStore';
import { fetchOidcConfig, loginWithPassword, OidcConfig } from '@/api/auth';
import { performOidcLogin, OidcCancelledError } from '@/utils/oidcLogin';
import { FontAwesome } from '@expo/vector-icons';
import { getServerUrl, setServerUrl as persistServerUrl } from '@/utils/storage';
import { setApiBaseUrl } from '@/api/client';

WebBrowser.maybeCompleteAuthSession();

type Step = 'server' | 'credentials';

function normalizeServerUrl(url: string): string {
  let trimmed = url.trim();
  if (!trimmed) return '';
  if (!/^https?:\/\//i.test(trimmed)) {
    trimmed = `https://${trimmed}`;
  }
  return trimmed.replace(/\/$/, '');
}

export function LoginScreen() {
  const { t } = useTranslation();
  const { setAuth } = useAuthStore();
  const [step, setStep] = useState<Step>('server');
  const [serverUrl, setServerUrlInput] = useState('');
  const [ssoConfig, setSsoConfig] = useState<OidcConfig | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSsoLoading, setIsSsoLoading] = useState(false);
  const [isCheckingServer, setIsCheckingServer] = useState(false);

  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    getServerUrl().then((stored) => {
      if (stored) {
        setServerUrlInput(stored);
      }
    });
  }, []);

  useEffect(() => {
    fadeAnim.setValue(0);
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 260,
      useNativeDriver: true,
    }).start();
  }, [step]);

  async function handleContinue() {
    const normalized = normalizeServerUrl(serverUrl);
    if (!normalized) {
      Alert.alert(t('login.alerts.serverAddressMissingTitle'), t('login.alerts.serverAddressMissingMessage'));
      return;
    }

    setApiBaseUrl(normalized);
    setIsCheckingServer(true);
    try {
      const config = await fetchOidcConfig();
      setSsoConfig(config);
      setServerUrlInput(normalized);
      await persistServerUrl(normalized);
      setStep('credentials');
    } catch (err: any) {
      Alert.alert(t('login.alerts.serverUnreachableTitle'), t('login.alerts.serverUnreachableMessage'));
    } finally {
      setIsCheckingServer(false);
    }
  }

  function handleChangeServer() {
    setStep('server');
  }

  async function handleSsoLogin() {
    setApiBaseUrl(serverUrl);
    setIsSsoLoading(true);
    try {
      const config = ssoConfig ?? (await fetchOidcConfig());
      if (!config.enabled) {
        Alert.alert(t('login.alerts.loginFailedTitle'), t('login.ssoNotConfigured'));
        return;
      }

      const loginResult = await performOidcLogin(config);
      await setAuth(loginResult.user, loginResult.token, serverUrl);
    } catch (err: any) {
      if (err instanceof OidcCancelledError) return;
      Alert.alert(t('login.alerts.loginFailedTitle'), err.response?.data?.error || err.message || t('common.tryAgain'));
    } finally {
      setIsSsoLoading(false);
    }
  }

  async function handlePasswordLogin() {
    if (!email.trim() || !password) {
      Alert.alert(t('login.alerts.loginFailedTitle'), t('login.alerts.enterEmailAndPassword'));
      return;
    }

    setApiBaseUrl(serverUrl);
    setIsLoading(true);
    try {
      const result = await loginWithPassword(email.trim(), password);
      await setAuth(result.user, result.token, serverUrl);
    } catch (err: any) {
      Alert.alert(t('login.alerts.loginFailedTitle'), err.response?.data?.error || err.message || t('common.tryAgain'));
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
        <View style={styles.logoSection}>
          <AppIcon size={96} />
          <Text style={styles.title}>{t('common.appName')}</Text>
          <Text style={styles.subtitle}>{t('login.subtitle')}</Text>
        </View>

        <View style={styles.stepDots}>
          <View style={[styles.stepDot, styles.stepDotActive]} />
          <View style={[styles.stepDot, step === 'credentials' && styles.stepDotActive]} />
        </View>

        {step === 'server' ? (
          <Animated.View style={[styles.stepContainer, { opacity: fadeAnim }]}>
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>{t('login.serverLabel')}</Text>
              <TextInput
                style={styles.input}
                value={serverUrl}
                onChangeText={setServerUrlInput}
                placeholder={t('login.serverPlaceholder')}
                placeholderTextColor={colors.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                textContentType="URL"
                returnKeyType="go"
                onSubmitEditing={handleContinue}
              />
              <Text style={styles.inputHint}>
                {t('login.serverHint')}
              </Text>
            </View>

            <TouchableOpacity
              style={[styles.loginButton, isCheckingServer && styles.loginButtonDisabled]}
              onPress={handleContinue}
              disabled={isCheckingServer}
            >
              <Text style={styles.loginButtonText}>
                {isCheckingServer ? t('common.loading') : t('login.continueButton')}
              </Text>
            </TouchableOpacity>
          </Animated.View>
        ) : (
          <Animated.View style={[styles.stepContainer, { opacity: fadeAnim }]}>
            <TouchableOpacity style={styles.serverChip} onPress={handleChangeServer}>
              <FontAwesome name="server" size={13} color={colors.textMuted} />
              <Text style={styles.serverChipText} numberOfLines={1}>{serverUrl}</Text>
              <Text style={styles.serverChipEdit}>{t('login.changeServer')}</Text>
            </TouchableOpacity>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>{t('login.emailLabel')}</Text>
              <TextInput
                style={styles.input}
                value={email}
                onChangeText={setEmail}
                placeholder={t('login.emailPlaceholder')}
                placeholderTextColor={colors.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                textContentType="emailAddress"
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>{t('login.passwordLabel')}</Text>
              <TextInput
                style={styles.input}
                value={password}
                onChangeText={setPassword}
                placeholder={t('login.passwordPlaceholder')}
                placeholderTextColor={colors.textMuted}
                secureTextEntry
                textContentType="password"
              />
            </View>

            <TouchableOpacity
              style={[styles.loginButton, isLoading && styles.loginButtonDisabled]}
              onPress={handlePasswordLogin}
              disabled={isLoading}
            >
              <Text style={styles.loginButtonText}>
                {isLoading ? t('common.loading') : t('login.loginButton')}
              </Text>
            </TouchableOpacity>

            {ssoConfig?.enabled && (
              <>
                <View style={styles.divider}>
                  <View style={styles.dividerLine} />
                  <Text style={styles.dividerText}>{t('common.or')}</Text>
                  <View style={styles.dividerLine} />
                </View>

                <TouchableOpacity
                  style={[styles.ssoButton, isSsoLoading && styles.ssoButtonDisabled]}
                  onPress={handleSsoLogin}
                  disabled={isSsoLoading}
                >
                  <FontAwesome name="key" size={20} color={isSsoLoading ? colors.textMuted : colors.textTitle} />
                  <Text style={[styles.ssoButtonText, isSsoLoading && styles.ssoButtonTextDisabled]}>
                    {isSsoLoading ? t('common.loading') : t('login.loginWithSso', { name: ssoConfig?.name })}
                  </Text>
                </TouchableOpacity>
              </>
            )}

            <Text style={styles.hint}>
              {t('login.invitationOnly')}
            </Text>
          </Animated.View>
        )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  flex: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    paddingTop: 24,
    paddingBottom: 48,
  },
  logoSection: {
    alignItems: 'center',
    marginBottom: 28,
  },
  title: {
    fontFamily: 'Nunito_900Black',
    fontSize: 40,
    color: colors.primary,
    letterSpacing: -2,
    marginTop: 16,
  },
  subtitle: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 17,
    color: colors.textMuted,
    marginTop: 8,
  },
  stepDots: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 28,
  },
  stepDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.border,
  },
  stepDotActive: {
    backgroundColor: colors.primary,
    width: 20,
  },
  stepContainer: {
    width: '100%',
    alignItems: 'center',
  },
  serverChip: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.primaryTint,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 24,
  },
  serverChipText: {
    flex: 1,
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 13,
    color: colors.textMuted,
  },
  serverChipEdit: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 13,
    color: colors.primary,
  },
  illustration: {
    width: 230,
    height: 140,
    borderRadius: 22,
    backgroundColor: colors.primaryTint,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 52,
    borderWidth: 1,
    borderColor: colors.border,
  },
  illustrationLabel: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 11,
    color: colors.textMuted,
    backgroundColor: colors.white,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
  },
  inputGroup: {
    width: '100%',
    marginBottom: 20,
  },
  inputLabel: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 14,
    color: colors.textTitle,
    marginBottom: 8,
  },
  input: {
    width: '100%',
    height: 52,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.white,
    paddingHorizontal: 16,
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 16,
    color: colors.textTitle,
  },
  inputHint: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 8,
    lineHeight: 17,
  },
  loginButton: {
    width: '100%',
    height: 56,
    borderRadius: 100,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 14,
    elevation: 3,
  },
  loginButtonDisabled: {
    opacity: 0.6,
  },
  loginButtonText: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 17,
    color: colors.white,
  },
  divider: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    gap: 12,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.border,
  },
  dividerText: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 13,
    color: colors.textMuted,
  },
  ssoButton: {
    width: '100%',
    height: 56,
    borderRadius: 100,
    borderWidth: 1.5,
    borderColor: colors.border,
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
  ssoButtonDisabled: {
    backgroundColor: colors.bg,
    shadowOpacity: 0,
    elevation: 0,
  },
  ssoButtonText: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 17,
    color: colors.textTitle,
  },
  ssoButtonTextDisabled: {
    color: colors.textMuted,
  },
  hint: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 13,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 20,
  },
});
