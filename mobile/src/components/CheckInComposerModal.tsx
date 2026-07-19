import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Modal,
  ScrollView,
  Image,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import * as ImagePicker from 'expo-image-picker';

import { colors } from '@/constants/colors';
import { Icon } from '@/components/Icon';
import { getUploadUrl } from '@/api/uploads';
import { isVideoUrl } from '@/utils/media';
import { usePickAndUploadMedia } from '@/hooks/usePickAndUploadMedia';

interface CheckInComposerModalProps {
  visible: boolean;
  tripTitle: string;
  dayNumber: number;
  submitting: boolean;
  onCancel: () => void;
  onSubmit: (data: { place: string; text?: string; photoUrls: string[] }) => void;
}

// The "+ Check-in" modal (design 6f) — minimal on purpose (place is the only
// required field) since this is meant to be filled in on the go.
export function CheckInComposerModal({
  visible,
  tripTitle,
  dayNumber,
  submitting,
  onCancel,
  onSubmit,
}: CheckInComposerModalProps) {
  const { t } = useTranslation();
  const [place, setPlace] = useState('');
  const [text, setText] = useState('');
  const [photoUrls, setPhotoUrls] = useState<string[]>([]);
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    if (visible) {
      setPlace('');
      setText('');
      setPhotoUrls([]);
      setPendingCount(0);
    }
  }, [visible]);

  const { pick, uploading } = usePickAndUploadMedia({
    pickerOptions: {
      mediaTypes: ImagePicker.MediaTypeOptions.All,
      allowsMultipleSelection: true,
      selectionLimit: 6,
      quality: 0.8,
      videoMaxDuration: 120,
    },
    includeIndexInName: true,
    onPicked: (assets) => setPendingCount(assets.length),
    onError: () => setPendingCount(0),
  });

  async function pickPhotos() {
    const result = await pick();
    setPendingCount(0);
    if (result) setPhotoUrls((prev) => [...prev, ...result.urls]);
  }

  function removePhoto(url: string) {
    setPhotoUrls((prev) => prev.filter((u) => u !== url));
  }

  function handleSubmit() {
    const trimmedPlace = place.trim();
    if (!trimmedPlace) return;
    onSubmit({ place: trimmedPlace, text: text.trim() || undefined, photoUrls });
  }

  function handleCancel() {
    if (place.trim() || text.trim() || photoUrls.length > 0) {
      Alert.alert(t('common.cancel'), undefined, [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('common.done'), style: 'destructive', onPress: onCancel },
      ]);
      return;
    }
    onCancel();
  }

  const canSubmit = place.trim().length > 0 && !submitting && !uploading;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={handleCancel}>
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={handleCancel}>
            <Text style={styles.headerButton}>{t('common.cancel')}</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{t('trip.checkin.headerTitle')}</Text>
          <TouchableOpacity onPress={handleSubmit} disabled={!canSubmit}>
            {submitting ? (
              <ActivityIndicator size="small" color={colors.trip} />
            ) : (
              <Text style={[styles.headerButton, styles.headerButtonPrimary, !canSubmit && styles.headerButtonDisabled]}>
                {t('trip.checkin.submitButton')}
              </Text>
            )}
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={styles.form}>
          <Text style={styles.contextLine}>{t('trip.checkin.contextLine', { title: tripTitle, day: dayNumber })}</Text>

          <View>
            <Text style={styles.label}>{t('trip.checkin.placeLabel')}</Text>
            <View style={styles.placeInputRow}>
              <Text style={styles.placeIcon}>📍</Text>
              <TextInput
                style={styles.placeInput}
                placeholder={t('trip.checkin.placePlaceholder')}
                placeholderTextColor={colors.textMuted}
                value={place}
                onChangeText={setPlace}
                maxLength={80}
                autoFocus
              />
            </View>
          </View>

          <TextInput
            style={styles.textInput}
            placeholder={t('trip.checkin.textPlaceholder')}
            placeholderTextColor={colors.textMuted}
            value={text}
            onChangeText={setText}
            multiline
          />

          <View style={styles.photoGrid}>
            {photoUrls.map((url) => {
              const isVideo = isVideoUrl(url);
              return (
                <View key={url} style={styles.photoTile}>
                  <Image source={{ uri: getUploadUrl(url) }} style={styles.photoImage} />
                  {isVideo && (
                    <View style={styles.videoBadge} pointerEvents="none">
                      <Icon name="play" size={14} color={colors.white} />
                    </View>
                  )}
                  <TouchableOpacity style={styles.removePhotoButton} onPress={() => removePhoto(url)}>
                    <Icon name="x" size={12} color={colors.white} />
                  </TouchableOpacity>
                </View>
              );
            })}
            {Array.from({ length: pendingCount }).map((_, i) => (
              <View key={`pending-${i}`} style={[styles.photoTile, styles.photoTilePending]}>
                <ActivityIndicator size="small" color={colors.white} />
              </View>
            ))}
            <TouchableOpacity style={styles.addPhotoTile} onPress={pickPhotos} disabled={uploading}>
              <Icon name="plus" size={20} color={colors.trip} />
              <Text style={styles.addPhotoLabel}>{t('trip.checkin.addPhotoLabel')}</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
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
  headerButtonDisabled: {
    opacity: 0.4,
  },
  headerTitle: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 17,
    color: colors.textTitle,
  },
  form: {
    padding: 16,
    gap: 16,
  },
  contextLine: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 13,
    color: colors.tripDark,
  },
  label: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 13,
    color: colors.textMuted,
    marginBottom: 6,
  },
  placeInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.tripBg,
    borderWidth: 1.5,
    borderColor: colors.tripBorder,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 13,
  },
  placeIcon: {
    fontSize: 17,
  },
  placeInput: {
    flex: 1,
    fontFamily: 'Nunito_700Bold',
    fontSize: 18,
    color: colors.textTitle,
  },
  textInput: {
    fontFamily: 'Nunito_400Regular',
    fontSize: 16,
    color: colors.textTitle,
    lineHeight: 24,
    minHeight: 64,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingBottom: 14,
  },
  photoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  photoTile: {
    width: '48%',
    height: 100,
    borderRadius: 14,
    overflow: 'hidden',
    position: 'relative',
  },
  photoTilePending: {
    backgroundColor: colors.tripTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoImage: {
    width: '100%',
    height: '100%',
  },
  videoBadge: {
    position: 'absolute',
    bottom: 6,
    left: 6,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  removePhotoButton: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addPhotoTile: {
    width: '48%',
    height: 100,
    borderRadius: 14,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.tripBorder,
    backgroundColor: colors.tripBg,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  addPhotoLabel: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 12.5,
    color: colors.tripDark,
  },
});
