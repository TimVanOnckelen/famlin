import React from 'react';
import { View, Text, StyleSheet, ActivityIndicator, StyleProp, ViewStyle } from 'react-native';

import { colors } from '@/constants/colors';

interface UploadProgressOverlayProps {
  // Fraction (0-1) of the batch upload sent so far. Shown as a percentage
  // next to the spinner once it's a real number; while it's null (upload not
  // yet started, or in the CPU-bound resize step before the request opens)
  // the overlay falls back to a plain spinner, same as before this existed.
  progress?: number | null;
  style?: StyleProp<ViewStyle>;
}

// Shared "this attachment is still uploading" overlay for pending photo/video
// tiles (the new-post composer, comment/chat attachments). A single combined
// percentage for the whole batch — not per-file, since the client sends every
// picked asset as one multipart request — but that's still far more
// reassuring than an indefinite spinner for the several-second uploads large
// phone photos or videos can take.
export function UploadProgressOverlay({ progress, style }: UploadProgressOverlayProps) {
  return (
    <View style={[styles.overlay, style]} pointerEvents="none">
      <ActivityIndicator size="small" color={colors.white} />
      {typeof progress === 'number' && progress > 0 && (
        <Text style={styles.progressText}>{Math.round(progress * 100)}%</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  progressText: {
    marginTop: 4,
    fontSize: 11,
    fontWeight: '600',
    color: colors.white,
  },
});
