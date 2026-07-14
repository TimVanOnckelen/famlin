import React from 'react';
import { StyleSheet, FlatList, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';

import { colors } from '@/constants/colors';
import { PostCard } from '@/components/PostCard';
import { ScreenHeader } from '@/components/ScreenHeader';
import { EmptyState } from '@/components/EmptyState';
import { useCursorPagination } from '@/hooks/useCursorPagination';
import { fetchFavorites } from '@famlin/api-client';

export function FavoritesScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<any>();

  const { query, items: favorites, onEndReached } = useCursorPagination({
    queryKey: ['favorites'],
    queryFn: (cursor) => fetchFavorites(cursor),
  });
  const { isLoading, refetch } = query;

  useFocusEffect(
    React.useCallback(() => {
      refetch();
    }, [refetch])
  );

  return (
    <SafeAreaView style={styles.container}>
      <ScreenHeader title={t('favorites.title')} onBack={() => navigation.goBack()} />

      <FlatList
        data={favorites}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={isLoading} onRefresh={refetch} tintColor={colors.primary} />
        }
        renderItem={({ item }) => <PostCard post={item} showGroup />}
        onEndReached={onEndReached}
        onEndReachedThreshold={0.5}
        ListEmptyComponent={
          isLoading ? null : (
            <EmptyState
              title={t('favorites.emptyTitle')}
              subtitle={t('favorites.emptySubtitle')}
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
  list: {
    padding: 12,
    paddingBottom: 40,
    gap: 10,
  },
});
