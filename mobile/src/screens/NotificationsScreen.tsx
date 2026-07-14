import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { colors } from '@/constants/colors';
import { ScreenHeader } from '@/components/ScreenHeader';
import { EmptyState } from '@/components/EmptyState';
import { fetchNotifications, markNotificationRead, markAllNotificationsRead } from '@famlin/api-client';
import { formatDateTime } from '@/i18n/utils';

export function NotificationsScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const queryClient = useQueryClient();

  const { data: notifications, isLoading, refetch } = useQuery({
    queryKey: ['notifications'],
    queryFn: fetchNotifications,
    refetchInterval: 30000,
  });

  useFocusEffect(
    React.useCallback(() => {
      refetch();
    }, [refetch])
  );

  const markRead = useMutation({
    mutationFn: (id: string) => markNotificationRead(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      queryClient.invalidateQueries({ queryKey: ['unread-count'] });
    },
  });

  const markAllRead = useMutation({
    mutationFn: markAllNotificationsRead,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      queryClient.invalidateQueries({ queryKey: ['unread-count'] });
    },
  });

  return (
    <SafeAreaView style={styles.container}>
      <ScreenHeader
        title={t('notifications.title')}
        onBack={() => navigation.goBack()}
        right={
          <TouchableOpacity onPress={() => markAllRead.mutate()}>
            <Text style={styles.markAllText}>{t('notifications.markAllRead')}</Text>
          </TouchableOpacity>
        }
      />

      <FlatList
        data={notifications || []}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={isLoading} onRefresh={refetch} tintColor={colors.primary} />
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            style={[styles.notificationItem, !item.readAt && styles.unreadItem]}
            onPress={() => {
              markRead.mutate(item.id);
              if (item.relatedPostId) {
                navigation.navigate('PostDetail', { postId: item.relatedPostId });
              }
            }}
          >
            <View style={styles.dotContainer}>
              {!item.readAt && <View style={styles.unreadDot} />}
            </View>
            <View style={styles.notificationContent}>
              <Text style={styles.notificationMessage}>{item.message}</Text>
              <Text style={styles.notificationTime}>{formatDateTime(item.createdAt)}</Text>
            </View>
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          <EmptyState title={t('notifications.empty')} titleStyle={styles.emptyText} />
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
  markAllText: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 14,
    color: colors.primary,
  },
  list: {
    padding: 14,
  },
  notificationItem: {
    flexDirection: 'row',
    backgroundColor: colors.white,
    borderRadius: 14,
    padding: 14,
    marginBottom: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  unreadItem: {
    backgroundColor: colors.primaryTint,
  },
  dotContainer: {
    width: 20,
    paddingTop: 4,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.primary,
  },
  notificationContent: {
    flex: 1,
  },
  notificationMessage: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 16,
    color: colors.textTitle,
    lineHeight: 23,
  },
  notificationTime: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 6,
  },
  // Notifications' empty text is deliberately smaller/muted than the shared
  // EmptyState default.
  emptyText: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 15,
    color: colors.textMuted,
  },
});
