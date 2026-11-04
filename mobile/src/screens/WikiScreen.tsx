import React, { useState } from 'react'
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useNavigation, useRoute } from '@react-navigation/native'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { fetchGroups, fetchWikiCategories, fetchWikiPages, type WikiPageSummary } from '@famlin/api-client'

import { colors } from '@/constants/colors'
import { Icon } from '@/components/Icon'
import { ScreenHeader } from '@/components/ScreenHeader'
import { EmptyState } from '@/components/EmptyState'
import { WikiMeta } from '@/components/WikiMeta'
import { useCursorPagination } from '@/hooks/useCursorPagination'
import type { Group } from '@/types'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'

// The Family Wiki overview (issue #118): one family's wiki at a time, its
// categories as filter chips, a search box, and the pages — most recently
// updated first. Mirrors web's WikiHomePage.
export function WikiScreen() {
  const { t } = useTranslation()
  const navigation = useNavigation<any>()
  const route = useRoute<any>()
  const [selectedGroupId, setSelectedGroupId] = useState<string | undefined>(route.params?.groupId)
  // undefined = every category, '' = uncategorized pages only.
  const [category, setCategory] = useState<string | undefined>(undefined)
  const [queryInput, setQueryInput] = useState('')
  const debouncedQuery = useDebouncedValue(queryInput.trim())

  const groupsQuery = useQuery({ queryKey: ['groups'], queryFn: fetchGroups })
  const groups: Group[] = groupsQuery.data ?? []
  const family = groups.find((group) => group.id === selectedGroupId) ?? groups[0]
  const familyId = family?.id

  const categoriesQuery = useQuery({
    queryKey: ['wiki', 'categories', familyId],
    queryFn: () => fetchWikiCategories(familyId!),
    enabled: !!familyId,
  })
  const {
    query: pagesQuery,
    items: pages,
    onEndReached,
  } = useCursorPagination<WikiPageSummary>({
    queryKey: ['wiki', 'pages', familyId, debouncedQuery, category ?? null],
    queryFn: (cursor) => fetchWikiPages({ groupId: familyId!, q: debouncedQuery || undefined, category, cursor }),
    enabled: !!familyId,
  })

  const categories = categoriesQuery.data ?? []
  const typing = queryInput.trim() !== debouncedQuery
  const filtering = !!debouncedQuery || category !== undefined
  const loading = groupsQuery.isLoading || typing || pagesQuery.isLoading

  function selectFamily(id: string) {
    setSelectedGroupId(id)
    setCategory(undefined)
    setQueryInput('')
  }

  function refresh() {
    void groupsQuery.refetch()
    void categoriesQuery.refetch()
    void pagesQuery.refetch()
  }

  const failed = groupsQuery.isError || pagesQuery.isError

  const header = (
    <View>
      <Text style={styles.intro}>{t('wiki.intro')}</Text>
      <View style={styles.sectionRow}>
        <Text style={styles.sectionTitle}>{filtering ? t('wiki.results') : t('wiki.recentlyUpdated')}</Text>
        {!!family && (
          <TouchableOpacity
            style={styles.newButton}
            onPress={() => navigation.navigate('WikiEditor', { groupId: family.id, category: category || undefined })}
            accessibilityRole="button"
          >
            <Icon name="plus" size={16} color={colors.white} />
            <Text style={styles.newButtonText}>{t('wiki.newPage')}</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  )

  let empty: React.ReactNode = null
  if (failed) {
    empty = (
      <View style={styles.centered}>
        <Text style={styles.hint}>{t('wiki.loadFailed')}</Text>
        <TouchableOpacity
          style={styles.retryButton}
          onPress={() => (groupsQuery.isError ? groupsQuery.refetch() : pagesQuery.refetch())}
        >
          <Text style={styles.retryButtonText}>{t('common.tryAgain')}</Text>
        </TouchableOpacity>
      </View>
    )
  } else if (loading) {
    empty = (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.primary} />
      </View>
    )
  } else if (groupsQuery.isSuccess && groups.length === 0) {
    empty = <EmptyState title={t('wiki.noGroups')} centerSubtitle />
  } else if (pagesQuery.isSuccess && pages.length === 0) {
    empty = <EmptyState title={filtering ? t('wiki.noResults') : t('wiki.empty')} centerSubtitle />
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScreenHeader title={t('wiki.title')} onBack={() => navigation.goBack()} centered />

      {groups.length > 1 && (
        <View style={styles.filterRow}>
          <FlatList
            horizontal
            showsHorizontalScrollIndicator={false}
            data={groups}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.chipList}
            accessibilityLabel={t('wiki.family')}
            renderItem={({ item }) => {
              const active = item.id === familyId
              return (
                <TouchableOpacity
                  style={[styles.chip, active && styles.chipActive]}
                  onPress={() => selectFamily(item.id)}
                  accessibilityState={{ selected: active }}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>{item.name}</Text>
                </TouchableOpacity>
              )
            }}
          />
        </View>
      )}

      <View style={styles.searchBarContainer}>
        <Icon name="search" size={18} color={colors.textMuted} />
        <TextInput
          style={styles.searchInput}
          value={queryInput}
          onChangeText={setQueryInput}
          placeholder={t('wiki.searchPlaceholder')}
          placeholderTextColor={colors.textMuted}
          maxLength={200}
          returnKeyType="search"
          editable={!!family}
          accessibilityLabel={t('wiki.searchPlaceholder')}
        />
      </View>

      {categories.length > 0 && (
        <View style={styles.filterRow}>
          <FlatList
            horizontal
            showsHorizontalScrollIndicator={false}
            data={categories}
            keyExtractor={(item) => item.name ?? '\u0000'}
            contentContainerStyle={styles.chipList}
            accessibilityLabel={t('wiki.categories')}
            ListHeaderComponent={
              <TouchableOpacity
                style={[styles.chip, styles.firstChip, category === undefined && styles.chipActive]}
                onPress={() => setCategory(undefined)}
                accessibilityState={{ selected: category === undefined }}
              >
                <Text style={[styles.chipText, category === undefined && styles.chipTextActive]}>
                  {t('wiki.allCategories')}
                </Text>
              </TouchableOpacity>
            }
            renderItem={({ item }) => {
              const value = item.name ?? ''
              const active = category !== undefined && category.toLowerCase() === value.toLowerCase()
              return (
                <TouchableOpacity
                  style={[styles.chip, active && styles.chipActive]}
                  onPress={() => setCategory(value)}
                  accessibilityState={{ selected: active }}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>
                    {item.name ?? t('wiki.uncategorized')} <Text style={styles.chipCount}>{item.pageCount}</Text>
                  </Text>
                </TouchableOpacity>
              )
            }}
          />
        </View>
      )}

      <FlatList
        data={failed || loading ? [] : pages}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={header}
        ListEmptyComponent={empty ?? undefined}
        refreshControl={
          <RefreshControl
            refreshing={pagesQuery.isRefetching && !pagesQuery.isFetchingNextPage}
            onRefresh={refresh}
            tintColor={colors.primary}
          />
        }
        onEndReached={onEndReached}
        onEndReachedThreshold={0.5}
        ListFooterComponent={
          (pagesQuery.isFetchingNextPage ? (
            <ActivityIndicator color={colors.primary} style={styles.footer} />
          ) : pagesQuery.hasNextPage && !typing ? (
            <TouchableOpacity style={styles.loadMore} onPress={() => pagesQuery.fetchNextPage()}>
              <Text style={styles.loadMoreText}>{t('wiki.loadMore')}</Text>
            </TouchableOpacity>
          ) : null) ?? undefined
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.row}
            activeOpacity={0.7}
            onPress={() => navigation.navigate('WikiPage', { pageId: item.id })}
            accessibilityRole="button"
          >
            <Text style={styles.rowEmoji}>{item.emoji || '📄'}</Text>
            <View style={styles.rowBody}>
              <Text style={styles.rowTitle} numberOfLines={2}>
                {item.title}
              </Text>
              {!!item.excerpt && (
                <Text style={styles.rowExcerpt} numberOfLines={2}>
                  {item.excerpt}
                </Text>
              )}
              <WikiMeta page={item} />
            </View>
          </TouchableOpacity>
        )}
      />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  filterRow: { paddingVertical: 10 },
  chipList: { paddingHorizontal: 12, gap: 8, alignItems: 'center' },
  firstChip: { marginRight: 8 },
  chip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 100,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontFamily: 'Nunito_600SemiBold', fontSize: 14, color: colors.textTitle },
  chipTextActive: { color: colors.white },
  chipCount: { fontFamily: 'Nunito_700Bold', fontSize: 12, opacity: 0.7 },
  searchBarContainer: {
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
  list: { padding: 12, paddingBottom: 40, gap: 10 },
  intro: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 14,
    lineHeight: 20,
    color: colors.textMuted,
    marginBottom: 12,
  },
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  sectionTitle: { fontFamily: 'Nunito_800ExtraBold', fontSize: 18, color: colors.textTitle },
  newButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.primary,
    borderRadius: 100,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  newButtonText: { fontFamily: 'Nunito_700Bold', fontSize: 14, color: colors.white },
  row: {
    flexDirection: 'row',
    gap: 12,
    backgroundColor: colors.white,
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.border,
  },
  rowEmoji: { fontSize: 28, lineHeight: 34 },
  rowBody: { flex: 1 },
  rowTitle: { fontFamily: 'Nunito_800ExtraBold', fontSize: 16, color: colors.textTitle },
  rowExcerpt: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 14,
    lineHeight: 19,
    color: colors.textBody,
    marginTop: 2,
  },
  centered: { alignItems: 'center', justifyContent: 'center', paddingVertical: 40, gap: 12 },
  hint: { fontFamily: 'Nunito_600SemiBold', fontSize: 14, color: colors.textMuted, textAlign: 'center' },
  retryButton: {
    borderRadius: 100,
    borderWidth: 1,
    borderColor: colors.primary,
    paddingHorizontal: 18,
    paddingVertical: 8,
  },
  retryButtonText: { fontFamily: 'Nunito_700Bold', fontSize: 14, color: colors.primary },
  footer: { paddingVertical: 16 },
  loadMore: { alignItems: 'center', paddingVertical: 14 },
  loadMoreText: { fontFamily: 'Nunito_700Bold', fontSize: 14, color: colors.primary },
})
