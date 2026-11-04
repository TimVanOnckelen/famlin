import React, { useEffect, useState } from 'react'
import { View, Text, TextInput, StyleSheet, TouchableOpacity, Modal, FlatList, ActivityIndicator } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { fetchPosts, searchPosts, wikiPostLabel } from '@famlin/api-client'

import { colors } from '@/constants/colors'
import { Icon } from '@/components/Icon'
import { Avatar } from '@/components/Avatar'
import { formatRelativeDate } from '@/i18n/utils'
import type { Post } from '@/types'

interface WikiLinkPostModalProps {
  visible: boolean
  groupId: string
  onPick: (post: Post, label: string) => void
  onCancel: () => void
}

// The wiki editor's "Link a post" picker (issue #118): the family's recent
// posts, or a search over them; picking one hands it back to be inserted as
// a Markdown link (wikiPostLinkMarkdown). Mirrors web's WikiLinkPostModal.
export function WikiLinkPostModal({ visible, groupId, onPick, onCancel }: WikiLinkPostModalProps) {
  const { t, i18n } = useTranslation()
  const [queryInput, setQueryInput] = useState('')
  const [debounced, setDebounced] = useState('')

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(queryInput.trim()), 300)
    return () => clearTimeout(timer)
  }, [queryInput])

  const postsQuery = useQuery({
    queryKey: ['wiki', 'link-posts', groupId, debounced],
    queryFn: () => (debounced ? searchPosts({ groupId, q: debounced }) : fetchPosts({ groupIds: [groupId] })),
    enabled: visible,
  })
  const posts: Post[] = postsQuery.data?.items ?? []
  const typing = queryInput.trim() !== debounced

  const labelOf = (post: Post) =>
    wikiPostLabel(post, t('wiki.postFrom', { date: new Date(post.createdAt).toLocaleDateString(i18n.language) }))

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onCancel}>
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onCancel}>
            <Text style={styles.headerButton}>{t('common.cancel')}</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{t('wiki.linkPostTitle')}</Text>
          <View style={styles.headerSpacer} />
        </View>

        <View style={styles.searchBar}>
          <Icon name="search" size={18} color={colors.textMuted} />
          <TextInput
            style={styles.searchInput}
            value={queryInput}
            onChangeText={setQueryInput}
            maxLength={200}
            placeholder={t('wiki.linkPostSearch')}
            placeholderTextColor={colors.textMuted}
            accessibilityLabel={t('wiki.linkPostSearch')}
            returnKeyType="search"
          />
        </View>

        {postsQuery.isLoading || typing ? (
          <View style={styles.centered}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : postsQuery.isError ? (
          <View style={styles.centered}>
            <Text style={styles.hint}>{t('wiki.linkPostFailed')}</Text>
          </View>
        ) : posts.length === 0 ? (
          <View style={styles.centered}>
            <Text style={styles.hint}>{t('wiki.linkPostEmpty')}</Text>
          </View>
        ) : (
          <FlatList
            data={posts}
            keyExtractor={(item) => item.id}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.list}
            renderItem={({ item }) => {
              const label = labelOf(item)
              return (
                <TouchableOpacity style={styles.row} onPress={() => onPick(item, label)} accessibilityRole="button">
                  <Avatar name={item.author.name} avatarUrl={item.author.avatarUrl} size={36} />
                  <View style={styles.rowBody}>
                    <Text style={styles.rowTitle} numberOfLines={2}>
                      {label}
                    </Text>
                    <Text style={styles.rowMeta} numberOfLines={1}>
                      {item.author.name} · {formatRelativeDate(item.createdAt)}
                    </Text>
                  </View>
                </TouchableOpacity>
              )
            }}
          />
        )}
      </SafeAreaView>
    </Modal>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: colors.white,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerButton: { fontFamily: 'Nunito_700Bold', fontSize: 16, color: colors.primary },
  headerTitle: { fontFamily: 'Nunito_800ExtraBold', fontSize: 17, color: colors.textTitle },
  headerSpacer: { width: 60 },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.white,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  searchInput: {
    flex: 1,
    backgroundColor: colors.bg,
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 16,
    color: colors.textTitle,
    borderWidth: 1,
    borderColor: colors.border,
  },
  centered: { alignItems: 'center', justifyContent: 'center', paddingVertical: 40 },
  hint: { fontFamily: 'Nunito_600SemiBold', fontSize: 14, color: colors.textMuted, textAlign: 'center' },
  list: { padding: 12, gap: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.white,
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  rowBody: { flex: 1 },
  rowTitle: { fontFamily: 'Nunito_700Bold', fontSize: 15, color: colors.textTitle },
  rowMeta: { fontFamily: 'Nunito_600SemiBold', fontSize: 12, color: colors.textMuted, marginTop: 2 },
})
