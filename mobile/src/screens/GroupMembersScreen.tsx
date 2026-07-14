import React from 'react';
import { View, Text, StyleSheet, FlatList } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { colors } from '@/constants/colors';
import { Avatar } from '@/components/Avatar';
import { ScreenHeader } from '@/components/ScreenHeader';
import { EmptyState } from '@/components/EmptyState';
import { fetchGroupMembers } from '@famlin/api-client';

export function GroupMembersScreen() {
  const { t, i18n } = useTranslation();
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { groupId, groupName } = route.params as { groupId: string; groupName: string };

  const { data: members, isLoading } = useQuery({
    queryKey: ['groupMembers', groupId],
    queryFn: () => fetchGroupMembers(groupId),
  });

  return (
    <SafeAreaView style={styles.container}>
      <ScreenHeader title={groupName} onBack={() => navigation.goBack()} centered />

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
        ListEmptyComponent={!isLoading ? <EmptyState title={t('groupMembers.empty')} /> : null}
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
});
