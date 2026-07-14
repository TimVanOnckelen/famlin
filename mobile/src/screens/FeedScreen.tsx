import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { colors } from '@/constants/colors';
import { Logo } from '@/components/Logo';
import { Icon } from '@/components/Icon';
import { PostCard } from '@/components/PostCard';
import { EmptyState } from '@/components/EmptyState';
import { useCursorPagination } from '@/hooks/useCursorPagination';
import { Group } from '@/types';
import { fetchGroups, fetchUnreadNotificationCount, fetchOnThisDay, fetchPosts } from '@famlin/api-client';
import { useAuthStore } from '@/stores/authStore';

export function FeedScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const { user } = useAuthStore();
  // The feed is a filter over the user's families: empty selection = all of
  // them (the backend scopes to memberships), one or more = just those.
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);

  const { data: groups } = useQuery({
    queryKey: ['groups'],
    queryFn: fetchGroups,
  });

  const { data: unreadCount } = useQuery({
    queryKey: ['unread-count'],
    queryFn: fetchUnreadNotificationCount,
    refetchInterval: 30000,
  });

  const groupsLoaded = groups !== undefined;
  const hasGroups = !!groups && groups.length > 0;

  // Group-scoped affordances (members, on-this-day, search context) only
  // have one clear target when the filter narrows to exactly one family.
  const effectiveGroupIds =
    selectedGroupIds.length > 0 ? selectedGroupIds : (groups ?? []).map((g: Group) => g.id);
  const singleActiveGroup =
    effectiveGroupIds.length === 1
      ? groups?.find((g: Group) => g.id === effectiveGroupIds[0])
      : undefined;

  function toggleGroup(groupId: string) {
    setSelectedGroupIds((prev) =>
      prev.includes(groupId) ? prev.filter((id) => id !== groupId) : [...prev, groupId]
    );
  }

  const { data: onThisDay } = useQuery({
    queryKey: ['onThisDay', singleActiveGroup?.id],
    queryFn: () => fetchOnThisDay(singleActiveGroup!.id),
    enabled: !!singleActiveGroup,
  });

  const { query, items: posts, onEndReached } = useCursorPagination({
    queryKey: ['posts', [...selectedGroupIds].sort().join(',') || 'all'],
    queryFn: (cursor) => fetchPosts({ groupIds: selectedGroupIds, cursor }),
    enabled: hasGroups,
  });
  const { isLoading, isRefetching, refetch } = query;

  // Search is still a per-group feature (the backend search endpoint requires
  // one group) — use the narrowed family, or fall back to the first one, the
  // same default the single-select feed had.
  const searchGroup = singleActiveGroup ?? groups?.[0];

  function openMembers() {
    if (!singleActiveGroup) return;
    navigation.navigate('GroupMembers', {
      groupId: singleActiveGroup.id,
      groupName: singleActiveGroup.name,
    });
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" />
      <View style={styles.header}>
        <Logo size={36} />

        {/* Single family: show its name so the context stays clear — the
            filter row below only appears with more than one family. */}
        <View style={styles.headerTitleWrapper}>
          {hasGroups && groups!.length === 1 && (
            <Text style={styles.headerGroupName} numberOfLines={1}>
              {groups![0].name}
            </Text>
          )}
        </View>

        {!!singleActiveGroup && (
          <TouchableOpacity
            style={styles.membersButton}
            onPress={openMembers}
            accessibilityLabel={t('feed.viewMembers')}
          >
            <Icon name="users" size={18} color={colors.primary} />
          </TouchableOpacity>
        )}

        {hasGroups && (
          <TouchableOpacity
            style={styles.favoritesButton}
            onPress={() => navigation.navigate('Search', { groupId: searchGroup?.id, groupName: searchGroup?.name })}
            accessibilityLabel={t('search.title', { group: searchGroup?.name || '' })}
          >
            <Icon name="search" size={20} color={colors.textTitle} />
          </TouchableOpacity>
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

      {hasGroups && groups!.length > 1 && (
        <View style={styles.filterRow}>
          <FlatList
            horizontal
            data={[{ id: 'all', name: t('feed.allFamilies') } as Group, ...groups!]}
            keyExtractor={(item) => item.id}
            showsHorizontalScrollIndicator={false}
            renderItem={({ item }) => {
              const isAll = item.id === 'all';
              const isActive = isAll ? selectedGroupIds.length === 0 : selectedGroupIds.includes(item.id);
              return (
                <TouchableOpacity
                  style={[styles.groupChip, isActive && styles.groupChipActive]}
                  onPress={() => (isAll ? setSelectedGroupIds([]) : toggleGroup(item.id))}
                  accessibilityState={{ selected: isActive }}
                >
                  <Text style={[styles.groupChipText, isActive && styles.groupChipTextActive]}>
                    {item.name}
                  </Text>
                </TouchableOpacity>
              );
            }}
            contentContainerStyle={styles.groupList}
          />
        </View>
      )}

      <FlatList
        data={hasGroups ? posts : []}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.feedList}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />
        }
        renderItem={({ item }) => <PostCard post={item} showGroup={effectiveGroupIds.length > 1} />}
        onEndReached={onEndReached}
        onEndReachedThreshold={0.5}
        ListHeaderComponent={
          hasGroups && onThisDay && onThisDay.length > 0 ? (
            <TouchableOpacity
              style={styles.onThisDayBanner}
              onPress={() => navigation.navigate('PostDetail', { postId: onThisDay[0].id })}
            >
              <View style={styles.onThisDayIcon}>
                <Icon name="clock" size={20} color={colors.primary} />
              </View>
              <View style={styles.onThisDayText}>
                <Text style={styles.onThisDayTitle}>{t('feed.onThisDayTitle')}</Text>
                <Text style={styles.onThisDaySubtitle}>
                  {t('feed.onThisDayCount', { count: onThisDay.length })}
                </Text>
              </View>
              <Icon name="chevron-right" size={18} color={colors.textMuted} />
            </TouchableOpacity>
          ) : null
        }
        ListEmptyComponent={
          !groupsLoaded || (isLoading && hasGroups) ? null : !hasGroups ? (
            <EmptyState title={t('feed.noGroupsTitle')} subtitle={t('feed.noGroupsSubtitle')} />
          ) : (
            <EmptyState title={t('feed.emptyTitle')} subtitle={t('feed.emptySubtitle')} />
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
  headerTitleWrapper: {
    flex: 1,
    paddingHorizontal: 12,
  },
  headerGroupName: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 16,
    color: colors.textTitle,
  },
  filterRow: {
    paddingVertical: 10,
  },
  groupList: {
    paddingHorizontal: 12,
    gap: 8,
    alignItems: 'center',
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
    fontSize: 11,
    color: colors.white,
  },
  groupChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 100,
    // The filter row sits on the feed background, so chips are white cards
    // (they used to be bg-tinted inside the white header).
    backgroundColor: colors.white,
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
  onThisDayBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.white,
    borderRadius: 16,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: 'rgba(217, 106, 94, 0.2)',
  },
  onThisDayIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(217, 106, 94, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  onThisDayText: {
    flex: 1,
  },
  onThisDayTitle: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 15,
    color: colors.textTitle,
  },
  onThisDaySubtitle: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 2,
  },
});
