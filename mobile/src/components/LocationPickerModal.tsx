import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, Modal, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { useTranslation } from 'react-i18next';

import { colors } from '@/constants/colors';
import { Icon } from '@/components/Icon';
import { LeafletMap } from '@/components/LeafletMap';
import { reverseGeocode } from '@/utils/geocode';

const DEFAULT_CENTER = { latitude: 50.8503, longitude: 4.3517 }; // Brussels — used when no GPS fix is available yet

export interface PickedLocation {
  latitude: number;
  longitude: number;
  locationName: string;
}

interface LocationPickerModalProps {
  visible: boolean;
  initialLocation?: PickedLocation | null;
  onCancel: () => void;
  onConfirm: (location: PickedLocation) => void;
}

export function LocationPickerModal({ visible, initialLocation, onCancel, onConfirm }: LocationPickerModalProps) {
  const { t } = useTranslation();
  const [coords, setCoords] = useState(
    initialLocation
      ? { latitude: initialLocation.latitude, longitude: initialLocation.longitude }
      : DEFAULT_CENTER
  );
  const [locationName, setLocationName] = useState(initialLocation?.locationName || '');
  const [locating, setLocating] = useState(false);
  const [geocoding, setGeocoding] = useState(false);

  useEffect(() => {
    if (!visible) return;
    if (initialLocation) {
      setCoords({ latitude: initialLocation.latitude, longitude: initialLocation.longitude });
      setLocationName(initialLocation.locationName || '');
      return;
    }
    useCurrentLocation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  async function useCurrentLocation() {
    try {
      setLocating(true);
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      await handlePick({ latitude: position.coords.latitude, longitude: position.coords.longitude });
    } finally {
      setLocating(false);
    }
  }

  async function handlePick(picked: { latitude: number; longitude: number }) {
    setCoords(picked);
    setGeocoding(true);
    const name = await reverseGeocode(picked.latitude, picked.longitude);
    setGeocoding(false);
    if (name) setLocationName(name);
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onCancel}>
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onCancel}>
            <Text style={styles.headerButton}>{t('common.cancel')}</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{t('newPost.location.pickerTitle')}</Text>
          <TouchableOpacity onPress={() => onConfirm({ ...coords, locationName })}>
            <Text style={[styles.headerButton, styles.headerButtonPrimary]}>{t('common.done')}</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.mapContainer}>
          <LeafletMap
            latitude={coords.latitude}
            longitude={coords.longitude}
            interactive
            onPick={handlePick}
            style={styles.map}
          />
          <TouchableOpacity style={styles.locateButton} onPress={useCurrentLocation} disabled={locating}>
            {locating ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <Icon name="navigation" size={18} color={colors.primary} />
            )}
          </TouchableOpacity>
        </View>

        <View style={styles.footer}>
          <Text style={styles.label}>{t('newPost.location.nameLabel')}</Text>
          <View style={styles.nameInputRow}>
            <TextInput
              style={styles.nameInput}
              placeholder={t('newPost.location.namePlaceholder')}
              placeholderTextColor={colors.textMuted}
              value={locationName}
              onChangeText={setLocationName}
            />
            {geocoding && <ActivityIndicator size="small" color={colors.textMuted} />}
          </View>
          <Text style={styles.hint}>{t('newPost.location.tapHint')}</Text>
        </View>
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
    color: colors.primary,
    fontFamily: 'Nunito_700Bold',
  },
  headerTitle: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 17,
    color: colors.textTitle,
  },
  mapContainer: {
    flex: 1,
  },
  map: {
    flex: 1,
  },
  locateButton: {
    position: 'absolute',
    bottom: 16,
    right: 16,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  footer: {
    padding: 16,
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  label: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 13,
    color: colors.textTitle,
  },
  nameInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  nameInput: {
    flex: 1,
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 15,
    color: colors.textTitle,
    backgroundColor: colors.bg,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  hint: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 12,
    color: colors.textMuted,
  },
});
