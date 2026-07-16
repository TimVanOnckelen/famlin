import React from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { colors } from '@/constants/colors';
import { Icon } from '@/components/Icon';
import { ScreenHeader } from '@/components/ScreenHeader';
import { EmptyState } from '@/components/EmptyState';
import { fetchGroups, Group } from '@famlin/api-client';

// Only reached when the user belongs to more than one chat-enabled group —
// FeedScreen routes straight into ChatScreen otherwise. Groups are fetched
// (not passed via nav params) so this shares the same ['groups'] cache
// FeedScreen already populates, mirroring every other screen's own-fetch
// pattern (GroupMembersScreen, etc.) rather than threading data through params.
export function ChatGroupPickerScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<any>();

  const { data: groups, isLoading } = useQuery({
    queryKey: ['groups'],
    queryFn: fetchGroups,
  });

  const chatGroups = (groups ?? []).filter((g: Group) => g.chitchatEnabled);

  return (
    <SafeAreaView style={styles.container}>
      <ScreenHeader title={t('chat.pickerTitle')} onBack={() => navigation.goBack()} centered />

      <FlatList
        data={chatGroups}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.groupRow}
            onPress={() => navigation.navigate('Chat', { groupId: item.id, groupName: item.name })}
          >
            <View style={styles.groupIcon}>
              <Icon name="message-circle" size={18} color={colors.primary} />
            </View>
            <Text style={styles.groupName} numberOfLines={1}>
              {item.name}
            </Text>
            <Icon name="chevron-right" size={18} color={colors.textMuted} />
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          !isLoading ? (
            <EmptyState title={t('chat.pickerEmptyTitle')} subtitle={t('chat.pickerEmptySubtitle')} centerSubtitle />
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
  list: {
    padding: 16,
    gap: 10,
  },
  groupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.white,
    borderRadius: 16,
    padding: 14,
  },
  groupIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.primaryTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  groupName: {
    flex: 1,
    fontFamily: 'Nunito_700Bold',
    fontSize: 16,
    color: colors.textTitle,
  },
});
