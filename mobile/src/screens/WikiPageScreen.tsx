import React from 'react'
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  RefreshControl,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useNavigation, useRoute } from '@react-navigation/native'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { deleteWikiPage, fetchWikiPage } from '@famlin/api-client'

import { colors } from '@/constants/colors'
import { Icon } from '@/components/Icon'
import { ScreenHeader } from '@/components/ScreenHeader'
import { WikiContent } from '@/components/WikiContent'
import { WikiMeta } from '@/components/WikiMeta'

// One Family Wiki page (issue #118), read-only, with Edit/Delete for whoever
// may. A 404 (deleted, another family's, a circle you're not in) shows the
// same "not available" message. Mirrors web's WikiArticlePage.
export function WikiPageScreen() {
  const { t, i18n } = useTranslation()
  const navigation = useNavigation<any>()
  const route = useRoute<any>()
  const queryClient = useQueryClient()
  const { pageId } = route.params as { pageId: string }

  const pageQuery = useQuery({ queryKey: ['wiki', 'page', pageId], queryFn: () => fetchWikiPage(pageId) })
  const page = pageQuery.data

  const deleteMutation = useMutation({
    mutationFn: () => deleteWikiPage(pageId),
    onSuccess: () => {
      navigation.goBack()
      queryClient.removeQueries({ queryKey: ['wiki', 'page', pageId] })
      void queryClient.invalidateQueries({ queryKey: ['wiki'] })
    },
    onError: () => Alert.alert(t('common.error'), t('wiki.deleteFailed')),
  })

  function confirmDelete() {
    Alert.alert(t('wiki.delete'), t('wiki.deleteConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('wiki.delete'), style: 'destructive', onPress: () => deleteMutation.mutate() },
    ])
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScreenHeader title={t('wiki.title')} onBack={() => navigation.goBack()} centered />

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl
            refreshing={pageQuery.isRefetching}
            onRefresh={() => void pageQuery.refetch()}
            tintColor={colors.primary}
          />
        }
      >
        {pageQuery.isLoading && <ActivityIndicator color={colors.primary} style={styles.loading} />}
        {pageQuery.isError && !page && <Text style={styles.hint}>{t('wiki.notAvailable')}</Text>}

        {!!page && (
          <View style={styles.card}>
            <View style={styles.titleRow}>
              {!!page.emoji && <Text style={styles.emoji}>{page.emoji}</Text>}
              <Text style={styles.title}>{page.title}</Text>
            </View>
            <WikiMeta page={page} />

            {(page.canEdit || page.canManage) && (
              <View style={styles.actions}>
                {page.canEdit && (
                  <TouchableOpacity
                    style={styles.actionButton}
                    onPress={() => navigation.navigate('WikiEditor', { pageId: page.id })}
                    accessibilityRole="button"
                  >
                    <Icon name="edit-3" size={16} color={colors.primary} />
                    <Text style={styles.actionText}>{t('wiki.edit')}</Text>
                  </TouchableOpacity>
                )}
                {page.canManage && (
                  <TouchableOpacity
                    style={styles.actionButton}
                    onPress={confirmDelete}
                    disabled={deleteMutation.isPending}
                    accessibilityRole="button"
                  >
                    <Icon name="trash-2" size={16} color={colors.danger} />
                    <Text style={[styles.actionText, styles.dangerText]}>{t('wiki.delete')}</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}

            <View style={styles.content}>
              {page.content.trim() ? (
                <WikiContent content={page.content} />
              ) : (
                <Text style={styles.hint}>{t('wiki.emptyPage')}</Text>
              )}
            </View>

            {!!page.createdBy && (
              <Text style={styles.footer}>
                {t('wiki.createdBy', {
                  name: page.createdBy.name,
                  when: new Date(page.createdAt).toLocaleDateString(i18n.language, { dateStyle: 'long' }),
                })}
              </Text>
            )}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: 12, paddingBottom: 40 },
  loading: { marginTop: 40 },
  hint: { fontFamily: 'Nunito_600SemiBold', fontSize: 14, color: colors.textMuted, textAlign: 'center', padding: 16 },
  card: {
    backgroundColor: colors.white,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  emoji: { fontSize: 30 },
  title: { flex: 1, fontFamily: 'Nunito_900Black', fontSize: 24, lineHeight: 30, color: colors.textTitle },
  actions: { flexDirection: 'row', gap: 10, marginTop: 14 },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 100,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  actionText: { fontFamily: 'Nunito_700Bold', fontSize: 14, color: colors.primary },
  dangerText: { color: colors.danger },
  content: { marginTop: 16 },
  footer: { fontFamily: 'Nunito_600SemiBold', fontSize: 12, color: colors.textMuted, marginTop: 8 },
})
