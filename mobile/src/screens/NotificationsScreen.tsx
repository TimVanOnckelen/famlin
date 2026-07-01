import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  SafeAreaView,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import { colors } from '@/constants/colors';
import { Icon } from '@/components/Icon';
import { api } from '@/api/client';
import { Notification } from '@/types';

export function NotificationsScreen() {
  const navigation = useNavigation<any>();
  const queryClient = useQueryClient();

  const { data: notifications, refetch } = useQuery({
    queryKey: ['notifications'],
    queryFn: async () => {
      const response = await api.get<Notification[]>('/notifications');
      return response.data;
    },
  });

  const markRead = useMutation({
    mutationFn: async (id: string) => {
      await api.patch(`/notifications/${id}`, { read: true });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  const markAllRead = useMutation({
    mutationFn: async () => {
      await api.post('/notifications/mark-all-read');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Icon name="arrow-left" size={18} color={colors.coral} />
          <Text style={styles.backButtonText}>Terug</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Meldingen</Text>
        <TouchableOpacity onPress={() => markAllRead.mutate()}>
          <Text style={styles.markAllText}>Alles gelezen</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={notifications || []}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
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
              <Text style={styles.notificationTime}>{formatDate(item.createdAt)}</Text>
            </View>
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>Geen meldingen</Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

function formatDate(dateString: string) {
  const date = new Date(dateString);
  return date.toLocaleDateString('nl-NL', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.cream,
  },
  header: {
    paddingTop: 60,
    paddingHorizontal: 16,
    paddingBottom: 13,
    borderBottomWidth: 1,
    borderBottomColor: colors.lightGray,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.white,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 4,
  },
  backButtonText: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 17,
    color: colors.coral,
  },
  headerTitle: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 17,
    color: colors.warmBlack,
  },
  markAllText: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 14,
    color: colors.coral,
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
    backgroundColor: '#FFF8F3',
  },
  dotContainer: {
    width: 20,
    paddingTop: 4,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.coral,
  },
  notificationContent: {
    flex: 1,
  },
  notificationMessage: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 15,
    color: colors.warmBlack,
    lineHeight: 22,
  },
  notificationTime: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 12,
    color: colors.warmGray,
    marginTop: 6,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 60,
  },
  emptyText: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 15,
    color: colors.warmGray,
  },
});
