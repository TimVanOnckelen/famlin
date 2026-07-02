import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  SafeAreaView,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { colors } from '@/constants/colors';
import { Icon } from '@/components/Icon';
import { Avatar } from '@/components/Avatar';
import { api } from '@/api/client';

interface GroupMemberUser {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string | null;
  joinedAt: string;
}

export function GroupMembersScreen() {
  const { t, i18n } = useTranslation();
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { groupId, groupName } = route.params as { groupId: string; groupName: string };

  const { data: members, isLoading } = useQuery({
    queryKey: ['groupMembers', groupId],
    queryFn: async () => {
      const response = await api.get<GroupMemberUser[]>(`/groups/${groupId}/members`);
      return response.data;
    },
  });

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Icon name="arrow-left" size={18} color={colors.primary} />
          <Text style={styles.backButtonText}>{t('common.back')}</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {groupName}
        </Text>
        <View style={styles.headerRight} />
      </View>

      <FlatList
        data={members || []}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          members && members.length > 0 ? (
            <Text style={styles.countLabel}>
              {t('groupMembers.count', { count: members.length })}
            </Text>
          ) : null
        }
        renderItem={({ item }) => (
          <View style={styles.memberRow}>
            <Avatar name={item.name} avatarUrl={item.avatarUrl} size={44} />
            <View style={styles.memberInfo}>
              <Text style={styles.memberName}>{item.name}</Text>
              <Text style={styles.memberEmail}>{item.email}</Text>
            </View>
            <Text style={styles.joinedAt}>
              {t('groupMembers.joined', {
                date: new Date(item.joinedAt).toLocaleDateString(i18n.language),
              })}
            </Text>
          </View>
        )}
        ListEmptyComponent={
          !isLoading ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyStateText}>{t('groupMembers.empty')}</Text>
            </View>
          ) : null
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
    paddingTop: 12,
    paddingHorizontal: 16,
    paddingBottom: 13,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 4,
    width: 90,
  },
  backButtonText: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 17,
    color: colors.primary,
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontFamily: 'Nunito_700Bold',
    fontSize: 17,
    color: colors.textTitle,
  },
  headerRight: {
    width: 90,
  },
  list: {
    padding: 16,
    gap: 10,
  },
  countLabel: {
    fontFamily: 'Nunito_800ExtraBold',
    fontSize: 12,
    color: colors.textMuted,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.white,
    borderRadius: 16,
    padding: 14,
  },
  memberInfo: {
    flex: 1,
  },
  memberName: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 16,
    color: colors.textTitle,
  },
  memberEmail: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 2,
  },
  joinedAt: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 12,
    color: colors.textMuted,
    textAlign: 'right',
    maxWidth: 90,
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
});
