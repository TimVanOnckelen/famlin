import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Linking } from 'react-native';

import { colors } from '@/constants/colors';
import { Icon } from '@/components/Icon';
import { LeafletMap } from '@/components/LeafletMap';

interface PostLocationPreviewProps {
  latitude: number;
  longitude: number;
  locationName?: string | null;
  mapHeight?: number;
}

export function PostLocationPreview({ latitude, longitude, locationName, mapHeight = 140 }: PostLocationPreviewProps) {
  function openInBrowser() {
    Linking.openURL(`https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=16/${latitude}/${longitude}`);
  }

  return (
    <TouchableOpacity style={styles.container} activeOpacity={0.85} onPress={openInBrowser}>
      <View style={[styles.map, { height: mapHeight }]} pointerEvents="none">
        <LeafletMap latitude={latitude} longitude={longitude} style={styles.map} />
      </View>
      <View style={styles.labelRow}>
        <Icon name="map-pin" size={14} color={colors.primary} />
        <Text style={styles.labelText} numberOfLines={1}>
          {locationName || `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: 12,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
  },
  map: {
    width: '100%',
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: colors.bg,
  },
  labelText: {
    flex: 1,
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 13,
    color: colors.textTitle,
  },
});
