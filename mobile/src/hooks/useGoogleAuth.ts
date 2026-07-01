import * as WebBrowser from 'expo-web-browser';
import * as Google from 'expo-auth-session/providers/google';
import { useEffect } from 'react';
import { Platform } from 'react-native';

WebBrowser.maybeCompleteAuthSession();

export function useGoogleAuth(clientId: string) {
  const [request, response, promptAsync] = Google.useIdTokenAuthRequest({
    clientId,
  });

  useEffect(() => {
    if (response?.type === 'success') {
      // Handled by caller
    }
  }, [response]);

  return {
    request,
    response,
    promptAsync,
  };
}
