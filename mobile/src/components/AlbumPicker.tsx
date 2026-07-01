import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  FlatList,
  Image,
  ActivityIndicator,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';

import { colors } from '@/constants/colors';
import { Icon } from '@/components/Icon';
import { fetchImmichAlbums, fetchImmichAlbum, getImmichAssetUrl, type ImmichAsset, type ImmichAlbum } from '@/api/immich';

interface AlbumPickerProps {
  visible: boolean;
  selectedAssetIds: string[];
  onSelect: (assetIds: string[]) => void;
  onClose: () => void;
}

export function AlbumPicker({ visible, selectedAssetIds, onSelect, onClose }: AlbumPickerProps) {
  const [selectedAlbum, setSelectedAlbum] = useState<ImmichAlbum | null>(null);

  const { data: albums, isLoading: albumsLoading } = useQuery({
    queryKey: ['immich-albums'],
    queryFn: fetchImmichAlbums,
    enabled: visible,
  });

  const { data: albumDetail, isLoading: albumLoading } = useQuery({
    queryKey: ['immich-album', selectedAlbum?.id],
    queryFn: () => fetchImmichAlbum(selectedAlbum!.id),
    enabled: !!selectedAlbum && visible,
  });

  const [localSelection, setLocalSelection] = useState<string[]>(selectedAssetIds);

  React.useEffect(() => {
    setLocalSelection(selectedAssetIds);
  }, [selectedAssetIds, visible]);

  function toggleAsset(assetId: string) {
    setLocalSelection((prev) =>
      prev.includes(assetId) ? prev.filter((id) => id !== assetId) : [...prev, assetId]
    );
  }

  function handleConfirm() {
    onSelect(localSelection);
    onClose();
  }

  return (
    <Modal visible={visible} animationType="slide" transparent={false} onRequestClose={onClose}>
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} style={styles.backButton}>
            <Icon name="x" size={22} color={colors.coral} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>
            {selectedAlbum ? selectedAlbum.name : 'Kies een album'}
          </Text>
          <TouchableOpacity onPress={handleConfirm} style={styles.confirmButton}>
            <Text style={styles.confirmText}>
              {localSelection.length > 0 ? `Kies ${localSelection.length}` : 'Klaar'}
            </Text>
          </TouchableOpacity>
        </View>

        {!selectedAlbum ? (
          albumsLoading ? (
            <ActivityIndicator size="large" color={colors.coral} style={styles.loader} />
          ) : (
            <FlatList
              data={albums || []}
              keyExtractor={(item) => item.id}
              contentContainerStyle={styles.list}
              renderItem={({ item }) => (
                <TouchableOpacity style={styles.albumItem} onPress={() => setSelectedAlbum(item)}>
                  <View style={styles.albumThumbnail}>
                    {item.thumbnailAssetId ? (
                      <Image
                        source={{ uri: getImmichAssetUrl(item.thumbnailAssetId, 'thumbnail') }}
                        style={styles.thumbnailImage}
                      />
                    ) : (
                      <Icon name="image" size={28} color={colors.warmGray} />
                    )}
                  </View>
                  <View style={styles.albumInfo}>
                    <Text style={styles.albumName}>{item.name}</Text>
                    <Text style={styles.albumCount}>{item.assetCount} foto's</Text>
                  </View>
                  <Icon name="chevron-right" size={20} color={colors.warmGray} />
                </TouchableOpacity>
              )}
              ListEmptyComponent={
                <View style={styles.emptyState}>
                  <Text style={styles.emptyText}>Geen gedeelde albums gevonden</Text>
                  <Text style={styles.emptySubtext}>
                    Maak een gedeeld album aan in Immich
                  </Text>
                </View>
              }
            />
          )
        ) : albumLoading ? (
          <ActivityIndicator size="large" color={colors.coral} style={styles.loader} />
        ) : (
          <FlatList
            data={albumDetail?.assets.filter((a: ImmichAsset) => a.type === 'IMAGE') || []}
            keyExtractor={(item) => item.id}
            numColumns={3}
            contentContainerStyle={styles.grid}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={[
                  styles.assetItem,
                  localSelection.includes(item.id) && styles.assetItemSelected,
                ]}
                onPress={() => toggleAsset(item.id)}
              >
                <Image
                  source={{ uri: getImmichAssetUrl(item.id, 'thumbnail') }}
                  style={styles.assetImage}
                />
                {localSelection.includes(item.id) && (
                  <View style={styles.assetCheck}>
                    <Icon name="check" size={14} color={colors.white} />
                  </View>
                )}
              </TouchableOpacity>
            )}
          />
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.cream,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 60,
    paddingHorizontal: 16,
    paddingBottom: 13,
    backgroundColor: colors.white,
    borderBottomWidth: 1,
    borderBottomColor: colors.lightGray,
  },
  backButton: {
    padding: 4,
    width: 44,
  },
  headerTitle: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 17,
    color: colors.warmBlack,
    flex: 1,
    textAlign: 'center',
  },
  confirmButton: {
    width: 80,
    alignItems: 'flex-end',
  },
  confirmText: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 15,
    color: colors.coral,
  },
  loader: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  list: {
    padding: 12,
  },
  albumItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.white,
    borderRadius: 16,
    padding: 12,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  albumThumbnail: {
    width: 56,
    height: 56,
    borderRadius: 12,
    backgroundColor: colors.creamDark,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  thumbnailImage: {
    width: 56,
    height: 56,
  },
  albumInfo: {
    flex: 1,
    marginLeft: 12,
  },
  albumName: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 16,
    color: colors.warmBlack,
  },
  albumCount: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 13,
    color: colors.warmGray,
    marginTop: 2,
  },
  grid: {
    padding: 8,
  },
  assetItem: {
    flex: 1,
    aspectRatio: 1,
    margin: 4,
    borderRadius: 8,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  assetItemSelected: {
    borderColor: colors.coral,
  },
  assetImage: {
    width: '100%',
    height: '100%',
  },
  assetCheck: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.coral,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 80,
  },
  emptyText: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 16,
    color: colors.warmBlack,
  },
  emptySubtext: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 14,
    color: colors.warmGray,
    marginTop: 6,
  },
});
