import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

import { AppIcon } from '@/components/Logo';
import { colors } from '@/constants/colors';

// "Photo-collage arrival" from the styleguide: three tilted polaroid frames
// (−8° / −2° / +7°) over a soft primary-tint glow, instead of one static
// illustration — sets the photo-forward tone from first launch.
export function PhotoCollage() {
  return (
    <View style={styles.container}>
      <View style={styles.glow} />
      <View style={[styles.polaroid, styles.left]}>
        <View style={styles.photo}>
          <Text style={styles.photoEmoji}>👨‍👩‍👧</Text>
        </View>
      </View>
      <View style={[styles.polaroid, styles.right]}>
        <View style={styles.photo}>
          <Text style={styles.photoEmoji}>🎂</Text>
        </View>
      </View>
      <View style={[styles.polaroid, styles.center]}>
        <View style={[styles.photo, styles.photoLarge]}>
          <AppIcon size={44} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    height: 150,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glow: {
    position: 'absolute',
    width: 200,
    height: 120,
    borderRadius: 100,
    backgroundColor: colors.primaryTint,
    opacity: 0.8,
  },
  polaroid: {
    position: 'absolute',
    backgroundColor: colors.white,
    borderRadius: 6,
    padding: 5,
    paddingBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.14,
    shadowRadius: 10,
    elevation: 4,
  },
  left: {
    left: '16%',
    top: 18,
    transform: [{ rotate: '-8deg' }],
  },
  right: {
    right: '16%',
    top: 24,
    transform: [{ rotate: '7deg' }],
  },
  center: {
    top: 26,
    padding: 6,
    paddingBottom: 18,
    transform: [{ rotate: '-2deg' }],
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.16,
    shadowRadius: 14,
    elevation: 6,
  },
  photo: {
    width: 58,
    height: 58,
    borderRadius: 3,
    backgroundColor: colors.primaryTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoLarge: {
    width: 66,
    height: 66,
  },
  photoEmoji: {
    fontSize: 26,
  },
});
