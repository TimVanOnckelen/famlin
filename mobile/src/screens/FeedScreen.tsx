import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  SafeAreaView,
  StatusBar,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useQuery, useInfiniteQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { colors } from '@/constants/colors';
import { Logo } from '@/components/Logo';
import { Icon } from '@/components/Icon';
import { PostCard } from '@/components/PostCard';
import { api } from '@/api/client';
import { Post, Group } from '@/types';
import { useAuthStore } from '@/stores/authStore';

export function FeedScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const { user } = useAuthStore();
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);

  const { data: groups } = useQuery({
    queryKey: ['groups'],
    queryFn: async () => {
      const response = await api.get<Group[]>('/groups');
      return response.data;
    },
  });

  const { data: unreadCount } = useQuery({
    queryKey: ['unread-count'],
    queryFn: async () => {
      const response = await api.get<{ count: number }>('/notifications/unread-count');
      return response.data.count;
    },
    refetchInterval: 30000,
  });

  const activeGroupId = selectedGroupId || groups?.[0]?.id;
  const activeGroup = groups?.find((g: Group) => g.id === activeGroupId);
  const groupsLoaded = groups !== undefined;
  const hasGroups = !!groups && groups.length > 0;

  const {
    data,
    isLoading,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ['posts', activeGroupId],
    queryFn: async ({ pageParam }: { pageParam?: string }) => {
      const response = await api.get<{ items: Post[]; nextCursor: string | null }>('/posts', {
        params: { groupId: activeGroupId, cursor: pageParam },
      });
      return response.data;
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: !!activeGroupId,
  });

  const posts = data?.pages.flatMap((page) => page.items);

  function openMembers() {
    if (!activeGroup) return;
    navigation.navigate('GroupMembers', {
      groupId: activeGroup.id,
      groupName: activeGroup.name,
    });
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" />
      <View style={styles.header}>
        <Logo size={36} />

        {!hasGroups && <View style={styles.groupListWrapper} />}

        {hasGroups && (
          <>
            {groups!.length > 1 ? (
              <FlatList
                horizontal
                data={groups}
                keyExtractor={(item) => item.id}
                showsHorizontalScrollIndicator={false}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={[
                      styles.groupChip,
                      item.id === activeGroupId && styles.groupChipActive,
                    ]}
                    onPress={() => setSelectedGroupId(item.id)}
                  >
                    <Text
                      style={[
                        styles.groupChipText,
                        item.id === activeGroupId && styles.groupChipTextActive,
                      ]}
                    >
                      {item.name}
                    </Text>
                  </TouchableOpacity>
                )}
                contentContainerStyle={styles.groupList}
                style={styles.groupListWrapper}
              />
            ) : (
              // Single group: show the current group name so the context is always
              // clear, rendered as a static (non-toggle) chip.
              <View style={styles.groupListSingle}>
                <View style={[styles.groupChip, styles.groupChipActive]}>
                  <Text style={[styles.groupChipText, styles.groupChipTextActive]}>
                    {activeGroup?.name}
                  </Text>
                </View>
              </View>
            )}
            <TouchableOpacity
              style={styles.membersButton}
              onPress={openMembers}
              accessibilityLabel={t('feed.viewMembers')}
            >
              <Icon name="users" size={18} color={colors.primary} />
            </TouchableOpacity>
          </>
        )}

        <TouchableOpacity
          style={styles.favoritesButton}
          onPress={() => navigation.navigate('Favorites')}
          accessibilityLabel={t('feed.viewFavorites')}
        >
          <Icon name="bookmark" size={20} color={colors.textTitle} />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.notificationsButton}
          onPress={() => navigation.navigate('Notifications')}
          accessibilityLabel={t('tabs.notifications')}
        >
          <Icon name="bell" size={20} color={colors.textTitle} />
          {!!unreadCount && (
            <View style={styles.notificationsBadge}>
              <Text style={styles.notificationsBadgeText}>
                {unreadCount > 9 ? '9+' : unreadCount}
              </Text>
            </View>
          )}
        </TouchableOpacity>
      </View>

      <FlatList
        data={hasGroups ? posts || [] : []}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.feedList}
        refreshControl={
          <RefreshControl refreshing={isLoading} onRefresh={refetch} tintColor={colors.primary} />
        }
        renderItem={({ item }) => <PostCard post={item} />}
        onEndReached={() => hasNextPage && !isFetchingNextPage && fetchNextPage()}
        onEndReachedThreshold={0.5}
        ListEmptyComponent={
          !groupsLoaded || (isLoading && hasGroups) ? null : !hasGroups ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyStateText}>{t('feed.noGroupsTitle')}</Text>
              <Text style={styles.emptyStateSubtext}>{t('feed.noGroupsSubtitle')}</Text>
            </View>
          ) : (
            <View style={styles.emptyState}>
              <Text style={styles.emptyStateText}>{t('feed.emptyTitle')}</Text>
              <Text style={styles.emptyStateSubtext}>{t('feed.emptySubtitle')}</Text>
            </View>
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
  header: {
    backgroundColor: colors.white,
    paddingVertical: 10,
    paddingLeft: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    flexDirection: 'row',
    alignItems: 'center',
  },
  groupListWrapper: {
    flex: 1,
  },
  groupList: {
    paddingHorizontal: 12,
    gap: 8,
    alignItems: 'center',
  },
  groupListSingle: {
    flexDirection: 'row',
    flex: 1,
    paddingHorizontal: 12,
  },
  membersButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(217, 106, 94, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
    marginLeft: 4,
  },
  notificationsButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  notificationsBadge: {
    position: 'absolute',
    top: 4,
    right: 4,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  notificationsBadgeText: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 10,
    color: colors.white,
  },
  groupChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 100,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  groupChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  groupChipText: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 14,
    color: colors.textTitle,
  },
  groupChipTextActive: {
    color: colors.white,
  },
  feedList: {
    padding: 12,
    paddingBottom: 110,
    gap: 10,
  },
  favoritesButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  emptyStateText: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 16,
    color: colors.textTitle,
  },
  emptyStateSubtext: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 14,
    color: colors.textMuted,
    marginTop: 6,
  },
});
