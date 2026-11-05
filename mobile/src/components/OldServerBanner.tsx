import React, { useEffect, useState } from 'react'
import { View, Text, StyleSheet, TouchableOpacity, Linking } from 'react-native'
import { useTranslation } from 'react-i18next'
import { getCurrentServerUrl } from '@famlin/api-client'

import { colors } from '@/constants/colors'
import { Icon } from '@/components/Icon'
import { useServerInfo } from '@/hooks/useServerInfo'
import { useAuthStore } from '@/stores/authStore'
import {
  MIN_SERVER_VERSION,
  dismissOldServerBanner,
  getDismissedServerVersion,
  shouldShowOldServerBanner,
} from '@/utils/serverVersion'

export const SERVER_VERSIONS_DOCS_URL = 'https://famlin.app/docs/maintenance#app-and-server-versions'

// Soft warning (issue #381) when the connected server is older than the
// app's support window. Never blocking; dismissible once per server version.
export function OldServerBanner() {
  const { t } = useTranslation()
  const { data: serverInfo } = useServerInfo()
  const isAdmin = useAuthStore((s) => s.user?.isAdmin ?? false)
  const serverUrl = getCurrentServerUrl()
  const version = serverInfo?.version
  // `undefined` until the stored dismissal has been read, so the banner
  // doesn't flash before being hidden.
  const [dismissed, setDismissed] = useState<string | null | undefined>(undefined)

  useEffect(() => {
    let cancelled = false
    setDismissed(undefined)
    if (!serverUrl) return
    void getDismissedServerVersion(serverUrl).then((value) => {
      if (!cancelled) setDismissed(value)
    })
    return () => {
      cancelled = true
    }
  }, [serverUrl])

  if (!serverUrl || dismissed === undefined || !version || !shouldShowOldServerBanner(version, dismissed)) return null

  const onDismiss = () => {
    setDismissed(version)
    void dismissOldServerBanner(serverUrl, version)
  }

  return (
    <View style={styles.banner} accessibilityRole="alert" testID="old-server-banner">
      <Icon name="alert-triangle" size={20} color={colors.updateText} />
      <View style={styles.body}>
        <Text style={styles.title}>{t('serverVersion.title')}</Text>
        <Text style={styles.message}>
          {isAdmin
            ? t('serverVersion.adminMessage', { version: MIN_SERVER_VERSION, current: version })
            : t('serverVersion.memberMessage')}
        </Text>
        {isAdmin ? (
          <TouchableOpacity
            style={styles.link}
            onPress={() => void Linking.openURL(SERVER_VERSIONS_DOCS_URL)}
            accessibilityRole="link"
          >
            <Text style={styles.linkText}>{t('serverVersion.howToUpdate')}</Text>
            <Icon name="external-link" size={14} color={colors.primary} />
          </TouchableOpacity>
        ) : null}
      </View>
      <TouchableOpacity
        onPress={onDismiss}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        accessibilityRole="button"
        accessibilityLabel={t('serverVersion.dismiss')}
      >
        <Icon name="x" size={18} color={colors.updateText} />
      </TouchableOpacity>
    </View>
  )
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: colors.updateBg,
    borderColor: colors.updateBorder,
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    marginBottom: 10,
  },
  body: {
    flex: 1,
    gap: 4,
  },
  title: {
    fontFamily: 'Nunito_700Bold',
    color: colors.updateText,
  },
  message: {
    fontFamily: 'Nunito_400Regular',
    color: colors.textBody,
  },
  link: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
  },
  linkText: {
    fontFamily: 'Nunito_600SemiBold',
    color: colors.primary,
  },
})
