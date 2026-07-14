import React, { useEffect, useState } from 'react';
import { View, StyleSheet, FlatList, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';

import { colors } from '@/constants/colors';
import { Icon } from '@/components/Icon';
import { PostCard } from '@/components/PostCard';
import { ScreenHeader } from '@/components/ScreenHeader';
import { EmptyState } from '@/components/EmptyState';
import { useCursorPagination } from '@/hooks/useCursorPagination';
import { searchPosts } from '@famlin/api-client';

export function SearchScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { groupId, groupName } = route.params as { groupId: string; groupName: string };

  const [queryInput, setQueryInput] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(queryInput.trim()), 300);
    return () => clearTimeout(timer);
  }, [queryInput]);

  const { query, items: results, onEndReached } = useCursorPagination({
    queryKey: ['postSearch', groupId, debouncedQuery],
    queryFn: (cursor) => searchPosts({ groupId, q: debouncedQuery, cursor }),
    enabled: debouncedQuery.length > 0,
  });
  const { isLoading } = query;

  return (
    <SafeAreaView style={styles.container}>
      <ScreenHeader
        title={t('search.title', { group: groupName })}
        onBack={() => navigation.goBack()}
        centered
      />

      <View style={styles.searchBarContainer}>
        <Icon name="search" size={18} color={colors.textMuted} />
        <TextInput
          style={styles.searchInput}
          value={queryInput}
          onChangeText={setQueryInput}
          placeholder={t('search.placeholder')}
          placeholderTextColor={colors.textMuted}
          autoFocus
          returnKeyType="search"
        />
      </View>

      <FlatList
        data={results}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => <PostCard post={item} />}
        onEndReached={onEndReached}
        onEndReachedThreshold={0.5}
        ListEmptyComponent={
          debouncedQuery.length === 0 ? null : isLoading ? null : (
            <EmptyState
              title={t('search.emptyTitle')}
              subtitle={t('search.emptySubtitle')}
              centerSubtitle
            />
          )
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  searchBarContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.white,
    paddingHorizontal: 16,
    paddingBottom: 12,
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
  list: {
    padding: 12,
    paddingBottom: 40,
    gap: 10,
  },
});
