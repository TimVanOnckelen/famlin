import React from 'react';
import { View, Text, StyleSheet, StyleProp, ViewStyle, TextStyle } from 'react-native';

import { colors } from '@/constants/colors';

interface EmptyStateProps {
  title: string;
  subtitle?: string;
  /** Centers the subtitle text (FavoritesScreen, SearchScreen); left-aligned
   * (the default) otherwise (FeedScreen, PhotosScreen). */
  centerSubtitle?: boolean;
  /** Style overrides for the one call site whose empty state deviates from
   * the common look (NotificationsScreen's smaller, single-line, muted
   * variant) — everyone else can leave these unset. */
  containerStyle?: StyleProp<ViewStyle>;
  titleStyle?: StyleProp<TextStyle>;
}

export function EmptyState({ title, subtitle, centerSubtitle, containerStyle, titleStyle }: EmptyStateProps) {
  return (
    <View style={[styles.emptyState, containerStyle]}>
      <Text style={[styles.emptyStateText, titleStyle]}>{title}</Text>
      {!!subtitle && (
        <Text style={[styles.emptyStateSubtext, centerSubtitle && styles.emptyStateSubtextCentered]}>
          {subtitle}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
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
  emptyStateSubtextCentered: {
    textAlign: 'center',
  },
});
