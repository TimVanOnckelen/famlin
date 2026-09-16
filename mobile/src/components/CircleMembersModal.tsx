import React from 'react';
import {
  Modal,
  SafeAreaView,
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { fetchCircleMembers } from '@famlin/api-client';
import { Avatar } from './Avatar';
import { colors } from '../constants/colors';

// Who is in this circle — opened by tapping the "shared in <Circle>" tag on a
// post, which is where a reader wonders "so who actually saw this?".
//
// This is the transparency half of the circle privacy model, not decoration.
// Admins are NOT implicit members and can't read a circle's content, but they
// CAN add themselves to one — so what members actually get is "nobody reads
// this silently", and that only holds if the membership is somewhere they can
// look. Showing when each person joined is the point: a name that appeared
// last week reads as new rather than blending into the founding members.
//
// The server 404s a circle the caller isn't in, so no permission check is
// needed here — a non-member never sees a tag to tap in the first place.
export function CircleMembersModal({
  visible,
  circleId,
  circleName,
  onClose,
}: {
  visible: boolean;
  circleId: string;
  circleName: string;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();

  const { data, isLoading, isError } = useQuery({
    queryKey: ['circle-members', circleId],
    queryFn: () => fetchCircleMembers(circleId),
    enabled: visible,
  });

  const members = data ?? [];

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <View style={styles.headerSpacer} />
          <Text style={styles.headerTitle} numberOfLines={1}>
            {circleName}
          </Text>
          <TouchableOpacity onPress={onClose}>
            <Text style={styles.headerButton}>{t('common.close')}</Text>
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={styles.body}>
          <Text style={styles.hint}>{t('circles.membersHint')}</Text>

          {isLoading && <ActivityIndicator size="small" color={colors.primary} style={styles.state} />}

          {isError && <Text style={styles.state}>{t('circles.membersLoadFailed')}</Text>}

          {!isLoading &&
            !isError &&
            members.map((member) => (
              <View key={member.id} style={styles.row}>
                <Avatar name={member.name} avatarUrl={member.avatarUrl} size={40} />
                <View style={styles.rowInfo}>
                  <Text style={styles.rowName}>{member.name}</Text>
                  <Text style={styles.rowJoined}>
                    {t('circles.joinedOn', {
                      date: new Date(member.joinedAt).toLocaleDateString(i18n.language),
                    })}
                  </Text>
                </View>
              </View>
            ))}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerSpacer: { width: 50 },
  headerTitle: {
    fontFamily: 'Nunito_800ExtraBold',
    fontSize: 17,
    color: colors.textTitle,
    flex: 1,
    textAlign: 'center',
  },
  headerButton: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 16,
    color: colors.primary,
    width: 50,
    textAlign: 'right',
  },
  body: { padding: 16, gap: 12 },
  hint: {
    fontFamily: 'Nunito_400Regular',
    fontSize: 13,
    color: colors.textMuted,
    lineHeight: 19,
    marginBottom: 4,
  },
  state: { fontFamily: 'Nunito_400Regular', fontSize: 14, color: colors.textMuted, paddingVertical: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  rowInfo: { flex: 1 },
  rowName: { fontFamily: 'Nunito_700Bold', fontSize: 15, color: colors.textTitle },
  rowJoined: { fontFamily: 'Nunito_400Regular', fontSize: 12, color: colors.textMuted },
});
