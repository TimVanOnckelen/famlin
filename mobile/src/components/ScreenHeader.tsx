import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useTranslation } from 'react-i18next';

import { colors } from '@/constants/colors';
import { Icon } from '@/components/Icon';

interface ScreenHeaderProps {
  title: string;
  onBack: () => void;
  /** Centers the title, giving the back button and the right-side slot
   * matching fixed widths so it truly centers (GroupMembersScreen,
   * SearchScreen, both of which show a dynamic-length title). Off by
   * default: the title just sits between the back button and the
   * right-side slot without being forced to center (FavoritesScreen,
   * NotificationsScreen, PostDetailScreen). */
  centered?: boolean;
  /** Custom right-side content, e.g. NotificationsScreen's "mark all read"
   * button. Defaults to an invisible spacer that balances the back button. */
  right?: React.ReactNode;
}

export function ScreenHeader({ title, onBack, centered = false, right }: ScreenHeaderProps) {
  const { t } = useTranslation();

  return (
    <View style={styles.header}>
      <TouchableOpacity onPress={onBack} style={[styles.backButton, centered && styles.backButtonCentered]}>
        <Icon name="arrow-left" size={18} color={colors.primary} />
        <Text style={styles.backButtonText}>{t('common.back')}</Text>
      </TouchableOpacity>
      <Text style={[styles.headerTitle, centered && styles.headerTitleCentered]} numberOfLines={1}>
        {title}
      </Text>
      {right !== undefined ? right : <View style={[styles.headerRight, centered && styles.headerRightCentered]} />}
    </View>
  );
}

const styles = StyleSheet.create({
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
  },
  backButtonCentered: {
    width: 90,
  },
  backButtonText: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 17,
    color: colors.primary,
  },
  headerTitle: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 17,
    color: colors.textTitle,
  },
  headerTitleCentered: {
    flex: 1,
    textAlign: 'center',
  },
  headerRight: {
    width: 70,
  },
  headerRightCentered: {
    width: 90,
  },
});
