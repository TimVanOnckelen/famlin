import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal, Pressable, ActivityIndicator } from 'react-native';
import { useTranslation } from 'react-i18next';

import { colors } from '@/constants/colors';

interface CloseTripSheetProps {
  visible: boolean;
  tripTitle: string;
  submitting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

// The "Reis afsluiten?" confirmation bottom sheet (design 6h) — irreversible,
// so this is a deliberate extra tap rather than a plain Alert.
export function CloseTripSheet({ visible, tripTitle, submitting, onCancel, onConfirm }: CloseTripSheetProps) {
  const { t } = useTranslation();

  return (
    <Modal transparent visible={visible} animationType="slide" onRequestClose={onCancel}>
      <Pressable style={styles.backdrop} onPress={onCancel}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <View style={styles.grabber} />
          <Text style={styles.title}>{t('trip.close.title')}</Text>
          <Text style={styles.description}>{t('trip.close.description', { title: tripTitle })}</Text>
          <View style={styles.actions}>
            <TouchableOpacity
              style={[styles.confirmButton, submitting && styles.buttonDisabled]}
              onPress={onConfirm}
              disabled={submitting}
            >
              {submitting ? (
                <ActivityIndicator size="small" color={colors.white} />
              ) : (
                <Text style={styles.confirmButtonText}>{t('trip.close.confirmButton')}</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity style={styles.cancelButton} onPress={onCancel} disabled={submitting}>
              <Text style={styles.cancelButtonText}>{t('trip.close.cancelButton')}</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.footnote}>{t('trip.close.footnote')}</Text>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(15,20,25,0.5)',
  },
  sheet: {
    backgroundColor: colors.white,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 40,
  },
  grabber: {
    width: 36,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.border,
    alignSelf: 'center',
    marginBottom: 18,
  },
  title: {
    fontFamily: 'Nunito_900Black',
    fontSize: 20,
    color: colors.textTitle,
    textAlign: 'center',
  },
  description: {
    fontFamily: 'Nunito_400Regular',
    fontSize: 15,
    color: colors.textMuted,
    lineHeight: 22,
    textAlign: 'center',
    marginTop: 8,
  },
  actions: {
    gap: 10,
    marginTop: 20,
  },
  confirmButton: {
    height: 50,
    borderRadius: 100,
    backgroundColor: colors.trip,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  confirmButtonText: {
    fontFamily: 'Nunito_800ExtraBold',
    fontSize: 15.5,
    color: colors.white,
  },
  cancelButton: {
    height: 50,
    borderRadius: 100,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelButtonText: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 15.5,
    color: colors.textMuted,
  },
  footnote: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 12.5,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: 14,
  },
});
