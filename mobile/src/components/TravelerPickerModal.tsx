import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  FlatList,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { colors } from '@/constants/colors';
import { Icon } from '@/components/Icon';
import { Avatar } from '@/components/Avatar';
import { fetchGroupMembers, GroupMember } from '@famlin/api-client';

// The server caps a trip at 20 co-travelers (author excluded).
const MAX_TRAVELERS = 20;

interface TravelerPickerModalProps {
  visible: boolean;
  groupId: string;
  // Never listed: the trip author is implicitly a traveler and must not be
  // sent in travelerUserIds (composer passes the logged-in user, trip detail
  // passes the post author — the same person in both flows today).
  excludeUserId?: string;
  initialSelectedIds: string[];
  submitting?: boolean;
  onCancel: () => void;
  onConfirm: (userIds: string[]) => void;
}

// Multi-select of a group's members, used for a trip's co-travelers — both
// by the new-post composer (selection kept local until the post is created)
// and by the trip detail screen's "edit travel companions" action (which
// calls setTripTravelers on confirm). Follows the LocationPickerModal /
// MediaPickerModal visible/onCancel/onConfirm modal shape.
export function TravelerPickerModal({
  visible,
  groupId,
  excludeUserId,
  initialSelectedIds,
  submitting = false,
  onCancel,
  onConfirm,
}: TravelerPickerModalProps) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (visible) setSelected(new Set(initialSelectedIds));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const { data: members, isLoading, isError } = useQuery<GroupMember[]>({
    queryKey: ['groupMembers', groupId],
    queryFn: () => fetchGroupMembers(groupId),
    enabled: visible && !!groupId,
  });

  const candidates = (members || []).filter((m) => m.id !== excludeUserId);

  function toggle(userId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else if (next.size < MAX_TRAVELERS) next.add(userId);
      return next;
    });
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onCancel}>
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onCancel} disabled={submitting}>
            <Text style={styles.headerButton}>{t('common.cancel')}</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{t('trip.travelers.pickerTitle')}</Text>
          <TouchableOpacity onPress={() => onConfirm(Array.from(selected))} disabled={submitting}>
            {submitting ? (
              <ActivityIndicator size="small" color={colors.trip} />
            ) : (
              <Text style={[styles.headerButton, styles.headerButtonPrimary]}>{t('trip.travelers.save')}</Text>
            )}
          </TouchableOpacity>
        </View>

        <Text style={styles.hint}>{t('trip.travelers.pickerHint')}</Text>

        {isLoading && (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color={colors.trip} />
          </View>
        )}

        {isError && (
          <View style={styles.centered}>
            <Text style={styles.mutedText}>{t('trip.travelers.loadError')}</Text>
          </View>
        )}

        {!isLoading && !isError && (
          <FlatList
            data={candidates}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.list}
            renderItem={({ item }) => {
              const isSelected = selected.has(item.id);
              return (
                <TouchableOpacity
                  style={styles.memberRow}
                  onPress={() => toggle(item.id)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: isSelected }}
                >
                  <Avatar name={item.name} avatarUrl={item.avatarUrl} size={40} />
                  <Text style={styles.memberName} numberOfLines={1}>
                    {item.name}
                  </Text>
                  <View style={[styles.checkCircle, isSelected && styles.checkCircleActive]}>
                    {isSelected && <Icon name="check" size={14} color={colors.white} />}
                  </View>
                </TouchableOpacity>
              );
            }}
            ListEmptyComponent={
              <View style={styles.centered}>
                <Text style={styles.mutedText}>{t('trip.travelers.noMembers')}</Text>
              </View>
            }
          />
        )}
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.white,
  },
  header: {
    paddingTop: 12,
    paddingHorizontal: 16,
    paddingBottom: 13,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerButton: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 16,
    color: colors.textMuted,
  },
  headerButtonPrimary: {
    color: colors.trip,
    fontFamily: 'Nunito_700Bold',
  },
  headerTitle: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 17,
    color: colors.textTitle,
  },
  hint: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 13,
    color: colors.textMuted,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  mutedText: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 15,
    color: colors.textMuted,
    textAlign: 'center',
  },
  list: {
    padding: 16,
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
  },
  memberName: {
    flex: 1,
    fontFamily: 'Nunito_700Bold',
    fontSize: 15,
    color: colors.textTitle,
  },
  checkCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkCircleActive: {
    backgroundColor: colors.trip,
    borderColor: colors.trip,
  },
});
