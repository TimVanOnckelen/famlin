import React, { useState } from 'react';
import { Alert, StyleSheet } from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import { useTranslation } from 'react-i18next';

import { LoginResponse } from '@/api/auth';
import { performAppleLogin, useAppleSignInAvailable, AppleCancelledError } from '@/utils/appleLogin';

interface AppleSignInButtonProps {
  // Whether the server this login targets actually implements POST
  // /api/auth/apple — comes from the appleSignInEnabled flag on
  // GET /auth/oidc-config, so an app talking to an older self-hosted server
  // hides the button instead of offering a login that would 404.
  serverSupported: boolean;
  onSuccess: (result: LoginResponse) => void | Promise<void>;
  inviteToken?: string;
}

// Apple's own button, rendered through their component rather than a
// look-alike, because guideline 4.8 reviews its styling and placement.
export function AppleSignInButton({ serverSupported, onSuccess, inviteToken }: AppleSignInButtonProps) {
  const { t } = useTranslation();
  const available = useAppleSignInAvailable();
  const [busy, setBusy] = useState(false);

  if (!available || !serverSupported) return null;

  async function handlePress() {
    if (busy) return;
    setBusy(true);
    try {
      const result = await performAppleLogin(inviteToken);
      await onSuccess(result);
    } catch (err: any) {
      if (err instanceof AppleCancelledError) return;
      Alert.alert(
        t('login.alerts.loginFailedTitle'),
        err.response?.data?.error || err.message || t('common.tryAgain')
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppleAuthentication.AppleAuthenticationButton
      buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
      buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
      cornerRadius={28}
      style={styles.button}
      onPress={handlePress}
    />
  );
}

const styles = StyleSheet.create({
  button: {
    width: '100%',
    height: 56,
    marginBottom: 16,
  },
});
