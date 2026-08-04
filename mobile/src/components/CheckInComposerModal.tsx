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
import { usePickAndUploadMedia } from '@/hooks/usePickAndUploadMedia';
import { cancelBatch, removeUpload, retryBatch, useBatchUploads } from '@/stores/uploadQueue';

// Matches the server's cap on a check-in's photoUrls array (routes/posts.ts
// interaction schema) — enforced here too so uploads never succeed only to
// have the interaction request rejected afterwards.
const MAX_CHECKIN_PHOTOS = 10;

interface CheckInComposerModalProps {
  visible: boolean;
  tripTitle: string;
  dayNumber: number;
  submitting: boolean;
  onCancel: () => void;
  /** Hands the upload batches over to the caller rather than the finished
   * URLs: the check-in may be submitted while photos are still uploading, so
   * it's the trip screen that waits for them to settle and then posts. */
  onSubmit: (data: { place: string; text?: string; batchIds: string[] }) => void;
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
  const [batchIds, setBatchIds] = useState<string[]>([]);

  // The photos live in the upload queue, not in local state, so they keep
  // uploading even while this modal is closing and the check-in is being
  // posted.
  const photos = useBatchUploads(batchIds);

  useEffect(() => {
    if (visible) {
      setPlace('');
      setText('');
      setBatchIds([]);
    }
  }, [visible]);

  const remainingPhotoSlots = MAX_CHECKIN_PHOTOS - photos.length;

  const { pickToQueue } = usePickAndUploadMedia({
    pickerOptions: {
      mediaTypes: ImagePicker.MediaTypeOptions.All,
      allowsMultipleSelection: true,
      selectionLimit: Math.max(1, remainingPhotoSlots),
      quality: 0.8,
      videoMaxDuration: 120,
    },
    includeIndexInName: true,
  });

  async function pickPhotos() {
    // Returns as soon as the picker closes — the upload runs in the
    // background queue, so the user can keep typing (or submit) while it's
    // still going.
    const result = await pickToQueue();
    if (result) setBatchIds((prev) => [...prev, result.batchId]);
  }

  function handleSubmit() {
    const trimmedPlace = place.trim();
    if (!trimmedPlace) return;
    onSubmit({ place: trimmedPlace, text: text.trim() || undefined, batchIds });
  }

  function handleCancel() {
    function discard() {
      // Only cancel on an actual abandon — on submit the batches are handed
      // to the trip screen, which owns them from then on.
      batchIds.forEach(cancelBatch);
      onCancel();
    }
    if (place.trim() || text.trim() || photos.length > 0) {
      Alert.alert(t('common.cancel'), undefined, [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('common.done'), style: 'destructive', onPress: discard },
      ]);
      return;
    }
    discard();
  }

  const uploadsInFlight = photos.filter((photo) => photo.status === 'pending' || photo.status === 'uploading').length;
  // Deliberately NOT blocked on uploads finishing: submitting hands the
  // in-flight batches to the trip screen, which posts once they settle.
  const canSubmit = place.trim().length > 0 && !submitting;

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
              <Icon name="map-pin" size={16} color={colors.trip} />
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
            {photos.map((photo) => (
              <View key={photo.id} style={styles.photoTile}>
                {/* The local file URI, so the preview is instant and costs no
                    network round trip — the uploaded copy is never fetched
                    back just to show a 100px tile. */}
                <Image source={{ uri: photo.file.uri }} style={styles.photoImage} />
                {photo.isVideo && (
                  <View style={styles.videoBadge} pointerEvents="none">
                    <Icon name="play" size={14} color={colors.white} />
                  </View>
                )}
                {(photo.status === 'pending' || photo.status === 'uploading') && (
                  <View style={styles.photoOverlay} pointerEvents="none">
                    <ActivityIndicator size="small" color={colors.white} />
                    <Text style={styles.photoOverlayText}>{Math.round(photo.progress * 100)}%</Text>
                  </View>
                )}
                {photo.status === 'failed' && (
                  <TouchableOpacity style={styles.photoRetryOverlay} onPress={() => retryBatch(photo.batchId)}>
                    <Icon name="refresh-cw" size={16} color={colors.white} />
                    <Text style={styles.photoOverlayText}>{t('common.tryAgain')}</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity style={styles.removePhotoButton} onPress={() => removeUpload(photo.id)}>
                  <Icon name="x" size={12} color={colors.white} />
                </TouchableOpacity>
              </View>
            ))}
            {photos.length < MAX_CHECKIN_PHOTOS && (
              <TouchableOpacity style={styles.addPhotoTile} onPress={pickPhotos}>
                <Icon name="plus" size={20} color={colors.trip} />
                <Text style={styles.addPhotoLabel}>{t('trip.checkin.addPhotoLabel')}</Text>
              </TouchableOpacity>
            )}
          </View>

          {uploadsInFlight > 0 && (
            <Text style={styles.uploadHint}>
              {t('trip.checkin.uploadHint', { count: uploadsInFlight })}
            </Text>
          )}
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
  photoOverlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  photoRetryOverlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(180,40,40,0.65)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  photoOverlayText: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 12,
    color: colors.white,
  },
  uploadHint: {
    fontFamily: 'Nunito_400Regular',
    fontSize: 13,
    color: colors.textMuted,
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
