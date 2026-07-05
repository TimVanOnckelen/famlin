import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  ActivityIndicator,
  Image,
  FlatList,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { colors } from '@/constants/colors';
import { Icon } from '@/components/Icon';
import { getUploadUrl } from '@/api/uploads';
import { getGroupImmichAlbums, getImmichAlbumAssets, ImmichAsset, ImmichGroupAlbum } from '@/api/immich';

interface ImmichPickerModalProps {
  visible: boolean;
  groupId: string;
  onCancel: () => void;
  onConfirm: (urls: string[]) => void;
}

// Lets a member pick photos/videos from their group's linked Immich
// album(s), following the same visible/onCancel/onConfirm shape as
// LocationPickerModal — a self-contained full-screen modal rather than a
// stack route, so NewPostScreen can just render it inline.
export function ImmichPickerModal({ visible, groupId, onCancel, onConfirm }: ImmichPickerModalProps) {
  const { t } = useTranslation();
  const { width } = useWindowDimensions();
  const columns = 3;
  const thumbSize = (width - 32 - (columns - 1) * 4) / columns;

  const [albums, setAlbums] = useState<ImmichGroupAlbum[] | null>(null);
  const [selectedLinkId, setSelectedLinkId] = useState<string | null>(null);
  const [assets, setAssets] = useState<ImmichAsset[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setAlbums(null);
    setSelectedLinkId(null);
    setAssets(null);
    setSelected(new Set());
    setError(null);
    setLoading(true);
    getGroupImmichAlbums(groupId)
      .then((result) => {
        setAlbums(result);
        if (result.length === 1) setSelectedLinkId(result[0].linkId);
      })
      .catch(() => setError(t('immichPicker.loadAlbumsError')))
      .finally(() => setLoading(false));
  }, [visible, groupId]);

  useEffect(() => {
    if (!selectedLinkId) return;
    setAssets(null);
    setLoading(true);
    getImmichAlbumAssets(selectedLinkId)
      .then(setAssets)
      .catch(() => setError(t('immichPicker.loadAssetsError')))
      .finally(() => setLoading(false));
  }, [selectedLinkId]);

  function toggle(assetId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(assetId)) next.delete(assetId);
      else next.add(assetId);
      return next;
    });
  }

  function handleConfirm() {
    const chosen = (assets ?? []).filter((a) => selected.has(a.assetId));
    // previewUrl is a JPEG still even for a video (Immich's thumbnail
    // endpoint never returns video bytes) — a video needs the original
    // rendition to actually be playable once attached to a post.
    onConfirm(chosen.map((a) => (a.type === 'VIDEO' ? a.originalUrl : a.previewUrl)));
  }

  const showAlbumList = !selectedLinkId && albums && albums.length > 1;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onCancel}>
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onCancel}>
            <Text style={styles.headerButton}>{t('common.cancel')}</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{t('immichPicker.title')}</Text>
          <TouchableOpacity onPress={handleConfirm} disabled={selected.size === 0}>
            <Text style={[styles.headerButton, styles.headerButtonPrimary, selected.size === 0 && styles.headerButtonDisabled]}>
              {t('immichPicker.addCount', { count: selected.size })}
            </Text>
          </TouchableOpacity>
        </View>

        {loading && (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        )}

        {!loading && error && (
          <View style={styles.centered}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {!loading && !error && showAlbumList && (
          <FlatList
            data={albums!}
            keyExtractor={(item) => item.linkId}
            contentContainerStyle={styles.albumList}
            renderItem={({ item }) => (
              <TouchableOpacity style={styles.albumRow} onPress={() => setSelectedLinkId(item.linkId)}>
                <Text style={styles.albumName}>{item.albumName}</Text>
                <Text style={styles.albumCount}>{item.assetCount}</Text>
                <Icon name="chevron-right" size={18} color={colors.textMuted} />
              </TouchableOpacity>
            )}
          />
        )}

        {!loading && !error && selectedLinkId && assets && (
          <FlatList
            data={assets}
            key={columns}
            numColumns={columns}
            keyExtractor={(item) => item.assetId}
            contentContainerStyle={styles.grid}
            columnWrapperStyle={styles.gridRow}
            ListEmptyComponent={
              <View style={styles.centered}>
                <Text style={styles.emptyText}>{t('immichPicker.noAssets')}</Text>
              </View>
            }
            renderItem={({ item }) => {
              const isSelected = selected.has(item.assetId);
              return (
                <TouchableOpacity
                  style={[styles.thumbWrapper, { width: thumbSize, height: thumbSize }]}
                  onPress={() => toggle(item.assetId)}
                >
                  <Image source={{ uri: getUploadUrl(item.thumbnailUrl) }} style={styles.thumb} />
                  {item.type === 'VIDEO' && (
                    <View style={styles.videoBadge} pointerEvents="none">
                      <Icon name="play" size={12} color={colors.white} />
                    </View>
                  )}
                  <View style={[styles.checkCircle, isSelected && styles.checkCircleActive]}>
                    {isSelected && <Icon name="check" size={12} color={colors.white} />}
                  </View>
                </TouchableOpacity>
              );
            }}
          />
        )}
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
  headerButtonDisabled: {
    opacity: 0.4,
  },
  headerTitle: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 17,
    color: colors.textTitle,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  errorText: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 15,
    color: colors.textMuted,
    textAlign: 'center',
  },
  emptyText: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 15,
    color: colors.textMuted,
  },
  albumList: {
    padding: 16,
    gap: 8,
  },
  albumRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: colors.bg,
  },
  albumName: {
    flex: 1,
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 15,
    color: colors.textTitle,
  },
  albumCount: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 13,
    color: colors.textMuted,
  },
  grid: {
    padding: 16,
    gap: 4,
  },
  gridRow: {
    gap: 4,
    marginBottom: 4,
  },
  thumbWrapper: {
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: colors.bg,
  },
  thumb: {
    width: '100%',
    height: '100%',
  },
  videoBadge: {
    position: 'absolute',
    left: 6,
    bottom: 6,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkCircle: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkCircleActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
});
