import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  ActivityIndicator,
  FlatList,
  useWindowDimensions,
} from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { colors } from '@/constants/colors';
import { Icon } from '@/components/Icon';
import { getUploadUrl } from '@/api/uploads';
import { getGroupMediaAlbums, getGroupMediaPeople, getMediaAlbumAssets, MediaAsset, MediaGroupAlbum, MediaPerson } from '@/api/media';

const AssetThumb = React.memo(function AssetThumb({
  asset,
  size,
  isSelected,
  onPress,
}: {
  asset: MediaAsset;
  size: number;
  isSelected: boolean;
  onPress: (assetId: string) => void;
}) {
  return (
    <TouchableOpacity
      style={[styles.thumbWrapper, { width: size, height: size }]}
      onPress={() => onPress(asset.assetId)}
    >
      <Image
        source={{ uri: getUploadUrl(asset.thumbnailUrl), cacheKey: asset.thumbnailUrl }}
        style={styles.thumb}
        contentFit="cover"
        cachePolicy="memory-disk"
        recyclingKey={asset.assetId}
      />
      {asset.type === 'VIDEO' && (
        <View style={styles.videoBadge} pointerEvents="none">
          <Icon name="play" size={12} color={colors.white} />
        </View>
      )}
      <View style={[styles.checkCircle, isSelected && styles.checkCircleActive]}>
        {isSelected && <Icon name="check" size={12} color={colors.white} />}
      </View>
    </TouchableOpacity>
  );
});

interface MediaPickerModalProps {
  visible: boolean;
  groupId: string;
  onCancel: () => void;
  onConfirm: (urls: string[]) => void;
}

// Lets a member pick photos/videos from their group's linked album(s),
// whatever media source they live on (Immich, a local folder on the
// server, ...) — following the same visible/onCancel/onConfirm shape as
// LocationPickerModal: a self-contained full-screen modal rather than a
// stack route, so NewPostScreen can just render it inline.
export function MediaPickerModal({ visible, groupId, onCancel, onConfirm }: MediaPickerModalProps) {
  const { t } = useTranslation();
  const { width } = useWindowDimensions();
  const columns = 3;
  const thumbSize = (width - 32 - (columns - 1) * 4) / columns;

  const [albums, setAlbums] = useState<MediaGroupAlbum[] | null>(null);
  const [selectedLinkId, setSelectedLinkId] = useState<string | null>(null);
  const [people, setPeople] = useState<MediaPerson[] | null>(null);
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null);
  const [assets, setAssets] = useState<MediaAsset[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setAlbums(null);
    setSelectedLinkId(null);
    setPeople(null);
    setSelectedPersonId(null);
    setAssets(null);
    setSelected(new Set());
    setError(null);
    setLoading(true);
    Promise.all([getGroupMediaAlbums(groupId), getGroupMediaPeople(groupId)])
      .then(([albums, people]) => {
        setAlbums(albums);
        setPeople(people);
        if (albums.length === 1) setSelectedLinkId(albums[0].linkId);
      })
      .catch(() => setError(t('mediaPicker.loadAlbumsError')))
      .finally(() => setLoading(false));
  }, [visible, groupId]);

  useEffect(() => {
    if (!selectedLinkId) return;
    setAssets(null);
    setLoading(true);
    getMediaAlbumAssets(selectedLinkId, selectedPersonId || undefined)
      .then(setAssets)
      .catch(() => setError(t('mediaPicker.loadAssetsError')))
      .finally(() => setLoading(false));
  }, [selectedLinkId, selectedPersonId]);

  const toggle = useCallback((assetId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(assetId)) next.delete(assetId);
      else next.add(assetId);
      return next;
    });
  }, []);

  const renderAsset = useCallback(
    ({ item }: { item: MediaAsset }) => (
      <AssetThumb asset={item} size={thumbSize} isSelected={selected.has(item.assetId)} onPress={toggle} />
    ),
    [thumbSize, selected, toggle]
  );

  // Uniform numColumns grid: row height is fixed and known up front, so
  // getItemLayout can skip on-the-fly measurement entirely (unlike
  // PhotosScreen's SectionList, which also has variable-height section
  // headers and isn't safe to hardcode the same way).
  const getItemLayout = useCallback(
    (_data: ArrayLike<MediaAsset> | null | undefined, index: number) => {
      const rowHeight = thumbSize + 4;
      return { length: rowHeight, offset: rowHeight * Math.floor(index / columns), index };
    },
    [thumbSize, columns]
  );

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
          <Text style={styles.headerTitle}>{t('mediaPicker.title')}</Text>
          <TouchableOpacity onPress={handleConfirm} disabled={selected.size === 0}>
            <Text style={[styles.headerButton, styles.headerButtonPrimary, selected.size === 0 && styles.headerButtonDisabled]}>
              {t('mediaPicker.addCount', { count: selected.size })}
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
          <>
            {people && people.length > 0 && (
              <View style={styles.filterRow}>
                <FlatList
                  horizontal
                  data={[{ id: null, label: t('mediaPicker.allPeople') }, ...people]}
                  keyExtractor={(item) => (item.id || 'all')}
                  showsHorizontalScrollIndicator={false}
                  renderItem={({ item }) => {
                    const isAll = item.id === null;
                    const isActive = isAll ? selectedPersonId === null : selectedPersonId === item.id;
                    return (
                      <TouchableOpacity
                        style={[styles.personChip, isActive && styles.personChipActive]}
                        onPress={() => (isAll ? setSelectedPersonId(null) : setSelectedPersonId(item.id))}
                        accessibilityState={{ selected: isActive }}
                      >
                        <Text style={[styles.personChipText, isActive && styles.personChipTextActive]}>
                          {item.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  }}
                  contentContainerStyle={styles.personList}
                />
              </View>
            )}
            <FlatList
              data={assets}
              key={columns}
              numColumns={columns}
              keyExtractor={(item) => item.assetId}
              contentContainerStyle={styles.grid}
              columnWrapperStyle={styles.gridRow}
              renderItem={renderAsset}
              getItemLayout={getItemLayout}
              removeClippedSubviews
              initialNumToRender={12}
              maxToRenderPerBatch={9}
              windowSize={7}
              updateCellsBatchingPeriod={50}
              ListEmptyComponent={
                <View style={styles.centered}>
                  <Text style={styles.emptyText}>{t('mediaPicker.noAssets')}</Text>
                </View>
              }
            />
          </>
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
  filterRow: {
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  personList: {
    paddingHorizontal: 12,
    gap: 8,
    alignItems: 'center',
  },
  personChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 100,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
  },
  personChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  personChipText: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 14,
    color: colors.textTitle,
  },
  personChipTextActive: {
    color: colors.white,
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
