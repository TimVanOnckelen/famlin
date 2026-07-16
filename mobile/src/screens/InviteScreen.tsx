import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  TextInput,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as WebBrowser from 'expo-web-browser';
import { useTranslation } from 'react-i18next';
import { FontAwesome } from '@expo/vector-icons';

import { AppIcon } from '@/components/Logo';
import { colors } from '@/constants/colors';
import { useAuthStore } from '@/stores/authStore';
import { fetchOidcConfig, loginWithPassword } from '@/api/auth';
import { performOidcLogin, OidcCancelledError } from '@/utils/oidcLogin';
import { fetchInvitePreview, registerViaInvite, acceptInvite, InvitePreview } from '@/api/invites';
import { getServerUrl, setServerUrl as persistServerUrl } from '@/utils/storage';
import { setApiBaseUrl, getCurrentServerUrl } from '@/api/client';

WebBrowser.maybeCompleteAuthSession();

interface InviteScreenProps {
  token: string;
  server?: string;
  onDone: () => void;
}

type Mode = 'loading' | 'error' | 'choose' | 'register' | 'login';

function normalizeServerUrl(url: string): string {
  let trimmed = url.trim();
  if (!trimmed) return '';
  if (!/^https?:\/\//i.test(trimmed)) {
    trimmed = `https://${trimmed}`;
  }
  return trimmed.replace(/\/$/, '');
}

export function InviteScreen({ token, server, onDone }: InviteScreenProps) {
  const { t } = useTranslation();
  const user = useAuthStore((state) => state.user);
  const setAuth = useAuthStore((state) => state.setAuth);
  const [mode, setMode] = useState<Mode>('loading');
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [errorMessage, setErrorMessage] = useState('');

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [ssoLoading, setSsoLoading] = useState(false);
  const [ssoEnabled, setSsoEnabled] = useState(false);
  const [ssoName, setSsoName] = useState('');

  useEffect(() => {
    (async () => {
      // A bad/expired invite link must never leave the app pointed at a
      // foreign server — remember what was active before we switch, and put
      // it back on every path that bails out without a completed invite.
      const previousServerUrl = getCurrentServerUrl();
      function restorePreviousServer() {
        if (previousServerUrl) setApiBaseUrl(previousServerUrl);
      }

      try {
        const targetServer = server ? normalizeServerUrl(server) : (await getServerUrl()) || '';
        if (!targetServer) {
          setErrorMessage(t('invite.errors.noServer'));
          setMode('error');
          return;
        }
        setApiBaseUrl(targetServer);

        let result: InvitePreview;
        try {
          result = await fetchInvitePreview(token);
        } catch (err: any) {
          // No `response` means the request never reached the server (bad
          // host, TLS failure, connection refused, timeout) — distinguish
          // that from the server actually saying the invite is invalid, so
          // the user isn't told to ask for a new invite when the real
          // problem is the server address baked into this link.
          if (!err?.response) {
            restorePreviousServer();
            setErrorMessage(t('invite.errors.serverUnreachable', { server: targetServer }));
            setMode('error');
            return;
          }
          throw err;
        }

        // Only persist the server URL once it's confirmed reachable —
        // otherwise a broken invite link could silently overwrite a
        // previously working stored server address.
        if (server) {
          await persistServerUrl(targetServer);
        }

        setPreview(result);

        if (result.status !== 'valid') {
          restorePreviousServer();
          setErrorMessage(
            result.status === 'expired'
              ? t('invite.errors.expired')
              : result.status === 'used'
              ? t('invite.errors.used')
              : t('invite.errors.notFound')
          );
          setMode('error');
          return;
        }

        if (result.email) setEmail(result.email);

        fetchOidcConfig()
          .then((config) => {
            setSsoEnabled(config.enabled);
            setSsoName(config.name);
          })
          .catch(() => setSsoEnabled(false));

        setMode('choose');
      } catch (err) {
        restorePreviousServer();
        setErrorMessage(t('invite.errors.notFound'));
        setMode('error');
      }
    })();
  }, [token, server]);

  async function handleJoinExisting() {
    setSubmitting(true);
    try {
      await acceptInvite(token);
      onDone();
    } catch (err: any) {
      Alert.alert(t('invite.alerts.failedTitle'), err.response?.data?.error || err.message || t('common.tryAgain'));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSsoLogin() {
    setSsoLoading(true);
    try {
      const config = await fetchOidcConfig();
      if (!config.enabled) {
        Alert.alert(t('invite.alerts.failedTitle'), t('login.ssoNotConfigured'));
        return;
      }

      const loginResult = await performOidcLogin(config, token);
      const serverUrl = (await getServerUrl()) || '';
      await setAuth(loginResult.user, loginResult.token, serverUrl);
      onDone();
    } catch (err: any) {
      if (err instanceof OidcCancelledError) return;
      Alert.alert(t('invite.alerts.failedTitle'), err.response?.data?.error || err.message || t('common.tryAgain'));
    } finally {
      setSsoLoading(false);
    }
  }

  async function handleRegister() {
    if (!name.trim() || !password) {
      Alert.alert(t('invite.alerts.failedTitle'), t('invite.errors.fillRequired'));
      return;
    }
    if (!preview?.email && !email.trim()) {
      Alert.alert(t('invite.alerts.failedTitle'), t('invite.errors.fillRequired'));
      return;
    }
    setSubmitting(true);
    try {
      const result = await registerViaInvite(token, {
        name: name.trim(),
        email: preview?.email ? undefined : email.trim(),
        password,
      });
      const serverUrl = (await getServerUrl()) || '';
      await setAuth(result.user, result.token, serverUrl);
      onDone();
    } catch (err: any) {
      Alert.alert(t('invite.alerts.failedTitle'), err.response?.data?.error || err.message || t('common.tryAgain'));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleLogin() {
    if (!email.trim() || !password) {
      Alert.alert(t('invite.alerts.failedTitle'), t('login.alerts.enterEmailAndPassword'));
      return;
    }
    setSubmitting(true);
    try {
      const result = await loginWithPassword(email.trim(), password, token);
      const serverUrl = (await getServerUrl()) || '';
      await setAuth(result.user, result.token, serverUrl);
      onDone();
    } catch (err: any) {
      Alert.alert(t('invite.alerts.failedTitle'), err.response?.data?.error || err.message || t('common.tryAgain'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.logoSection}>
            <AppIcon size={80} />
            <Text style={styles.title}>{t('common.appName')}</Text>
          </View>

          {mode === 'loading' && <ActivityIndicator size="large" color={colors.primary} />}

          {mode === 'error' && (
            <View style={styles.stepContainer}>
              <Text style={styles.errorText}>{errorMessage}</Text>
              <TouchableOpacity style={styles.loginButton} onPress={onDone}>
                <Text style={styles.loginButtonText}>{t('invite.continueToApp')}</Text>
              </TouchableOpacity>
            </View>
          )}

          {mode !== 'loading' && mode !== 'error' && preview && (
            <View style={styles.stepContainer}>
              <Text style={styles.subtitle}>
                {preview.inviterName
                  ? t('invite.invitedByTitle', { inviter: preview.inviterName, group: preview.groupName })
                  : t('invite.invitedTitle', { group: preview.groupName })}
              </Text>

              {mode === 'choose' && (
                <>
                  {user ? (
                    <TouchableOpacity
                      style={[styles.loginButton, submitting && styles.loginButtonDisabled]}
                      onPress={handleJoinExisting}
                      disabled={submitting}
                    >
                      <Text style={styles.loginButtonText}>
                        {submitting ? t('common.loading') : t('invite.joinButton', { group: preview.groupName })}
                      </Text>
                    </TouchableOpacity>
                  ) : (
                    <>
                      {ssoEnabled && (
                        <TouchableOpacity
                          style={[styles.ssoButton, ssoLoading && styles.ssoButtonDisabled]}
                          onPress={handleSsoLogin}
                          disabled={ssoLoading}
                        >
                          <FontAwesome name="key" size={20} color={ssoLoading ? colors.textMuted : colors.textTitle} />
                          <Text style={[styles.ssoButtonText, ssoLoading && styles.ssoButtonTextDisabled]}>
                            {ssoLoading ? t('common.loading') : t('login.loginWithSso', { name: ssoName })}
                          </Text>
                        </TouchableOpacity>
                      )}

                      <TouchableOpacity style={styles.loginButton} onPress={() => setMode('register')}>
                        <Text style={styles.loginButtonText}>{t('invite.createAccountButton')}</Text>
                      </TouchableOpacity>

                      <TouchableOpacity onPress={() => setMode('login')}>
                        <Text style={styles.linkText}>{t('invite.haveAccountLink')}</Text>
                      </TouchableOpacity>
                    </>
                  )}
                </>
              )}

              {mode === 'register' && (
                <>
                  {!preview.email && (
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
                  )}
                  <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>{t('invite.nameLabel')}</Text>
                    <TextInput
                      style={styles.input}
                      value={name}
                      onChangeText={setName}
                      placeholder={t('invite.namePlaceholder')}
                      placeholderTextColor={colors.textMuted}
                      textContentType="name"
                    />
                  </View>
                  <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>{t('invite.newPasswordLabel')}</Text>
                    <TextInput
                      style={styles.input}
                      value={password}
                      onChangeText={setPassword}
                      placeholder={t('login.passwordPlaceholder')}
                      placeholderTextColor={colors.textMuted}
                      secureTextEntry
                      textContentType="newPassword"
                    />
                  </View>
                  <TouchableOpacity
                    style={[styles.loginButton, submitting && styles.loginButtonDisabled]}
                    onPress={handleRegister}
                    disabled={submitting}
                  >
                    <Text style={styles.loginButtonText}>
                      {submitting ? t('common.loading') : t('invite.createAccountButton')}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => setMode('choose')}>
                    <Text style={styles.linkText}>{t('common.back')}</Text>
                  </TouchableOpacity>
                </>
              )}

              {mode === 'login' && (
                <>
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
                    style={[styles.loginButton, submitting && styles.loginButtonDisabled]}
                    onPress={handleLogin}
                    disabled={submitting}
                  >
                    <Text style={styles.loginButtonText}>
                      {submitting ? t('common.loading') : t('login.loginButton')}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => setMode('choose')}>
                    <Text style={styles.linkText}>{t('common.back')}</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>
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
    fontSize: 32,
    color: colors.primary,
    letterSpacing: -1.5,
    marginTop: 12,
  },
  stepContainer: {
    width: '100%',
    alignItems: 'center',
  },
  subtitle: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 19,
    color: colors.textTitle,
    textAlign: 'center',
    marginBottom: 28,
    lineHeight: 26,
  },
  errorText: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 15,
    color: colors.textMuted,
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 22,
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
    marginBottom: 16,
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
  linkText: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 14,
    color: colors.primary,
    marginTop: 4,
    paddingVertical: 8,
  },
});
