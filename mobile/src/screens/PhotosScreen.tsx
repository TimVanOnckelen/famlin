import React, { useState, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  StatusBar,
  useWindowDimensions,
  ActivityIndicator,
  SectionList,
} from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import i18n from '@/i18n';

import { colors } from '@/constants/colors';
import { Logo } from '@/components/Logo';
import { Icon } from '@/components/Icon';
import { EmptyState } from '@/components/EmptyState';
import { useCursorPagination } from '@/hooks/useCursorPagination';
import { PhotoItem } from '@/types';
import { fetchGroups, getGroupPhotoTimeline, getGroupMediaPeople } from '@famlin/api-client';
import { getUploadUrl } from '@/api/uploads';

const PhotoRow = React.memo(function PhotoRow({
  row,
  photoSize,
  columns,
  onPress,
}: {
  row: PhotoItem[];
  photoSize: number;
  columns: number;
  onPress: (photo: PhotoItem) => void;
}) {
  return (
    <View style={styles.gridRow}>
      {row.map((photo) => (
        <TouchableOpacity
          key={photo.id}
          style={[styles.photoWrapper, { width: photoSize, height: photoSize }]}
          onPress={() => onPress(photo)}
          activeOpacity={0.7}
        >
          <Image
            // cacheKey pins the disk cache to the asset path — the
            // full URL carries the rotating ?token=, which would
            // otherwise invalidate every cached thumbnail on each
            // media-token refresh.
            source={{ uri: getUploadUrl(photo.thumbnailUrl), cacheKey: photo.thumbnailUrl }}
            style={styles.photo}
            contentFit="cover"
            cachePolicy="memory-disk"
            transition={100}
            recyclingKey={photo.id}
          />
          {photo.type === 'VIDEO' && (
            <View style={styles.playIconOverlay} pointerEvents="none">
              <Icon name="play" size={24} color={colors.white} />
            </View>
          )}
        </TouchableOpacity>
      ))}
      {/* Fill empty spaces in the last row */}
      {row.length < columns &&
        Array.from({ length: columns - row.length }).map((_, idx) => (
          <View
            key={`empty-${idx}`}
            style={[styles.photoWrapper, { width: photoSize, height: photoSize }]}
          />
        ))}
    </View>
  );
});

export function PhotosScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const { width } = useWindowDimensions();

  // State for filters
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null);

  // Grid sizing
  const columns = 3;
  const photoSize = (width - 32 - (columns - 1) * 4) / columns;

  // Load groups
  const { data: groups } = useQuery({
    queryKey: ['groups'],
    queryFn: fetchGroups,
  });

  const groupsLoaded = groups !== undefined;
  const hasGroups = !!groups && groups.length > 0;

  // Set default group on first load
  const activeGroupId = selectedGroupId || (groups?.[0]?.id ?? null);

  // Load people for the active group
  const { data: people, isLoading: peopleLoading } = useQuery({
    queryKey: ['group-media-people', activeGroupId],
    queryFn: () => getGroupMediaPeople(activeGroupId!),
    enabled: !!activeGroupId,
  });

  // Load photo timeline for the active group
  const { query, items: allPhotos, onEndReached } = useCursorPagination({
    queryKey: ['photo-timeline', activeGroupId, selectedPersonId],
    queryFn: (cursor) =>
      getGroupPhotoTimeline(activeGroupId!, {
        cursor,
        personId: selectedPersonId || undefined,
      }),
    enabled: !!activeGroupId,
  });
  const { isLoading, isRefetching, refetch, isFetchingNextPage } = query;

  // Section photos by month
  const sections = useMemo(() => {
    const grouped = new Map<string, PhotoItem[]>();

    allPhotos.forEach((photo) => {
      const date = new Date(photo.takenAt);
      const monthKey = date.toLocaleDateString(i18n.language, {
        year: 'numeric',
        month: 'long',
      });

      if (!grouped.has(monthKey)) {
        grouped.set(monthKey, []);
      }
      grouped.get(monthKey)!.push(photo);
    });

    // Convert to sections array, maintaining insertion order (newest first)
    return Array.from(grouped.entries()).map(([month, photos]) => ({
      title: month,
      data: photos,
    }));
  }, [allPhotos]);

  // Chunk photos into rows for grid display
  const sectionListData = useMemo(() => {
    return sections.map((section) => {
      const rows: PhotoItem[][] = [];
      for (let i = 0; i < section.data.length; i += columns) {
        rows.push(section.data.slice(i, i + columns));
      }
      return {
        title: section.title,
        data: rows,
      };
    });
  }, [sections]);

  const handlePhotoTap = useCallback(
    (photo: PhotoItem) => {
      // Match PostCard's ImageViewer contract: every URL must be absolute and
      // carry the media token (getUploadUrl), since <Image>/<Video> requests
      // bypass axios entirely. Videos need the original rendition (real video
      // extension, so ImageViewerScreen's isVideoUrl() routes them to the
      // native player); images get the preview jpg — the original can be a
      // huge/HEIC file <Image> may not render (same split MediaPickerModal
      // makes when attaching assets to a post).
      const urls = allPhotos.map((p) =>
        getUploadUrl(p.type === 'VIDEO' ? p.originalUrl : p.previewUrl)
      );
      // Per-photo metadata: photos that belong to a post (direct uploads, or
      // album assets a post embeds — postAssetUrl) enable the viewer's
      // like/comment/favorite bar; downloadUrl points at the original
      // rendition since the pager itself shows the smaller preview.
      const items = allPhotos.map((p) => ({
        ...(p.postId ? { postId: p.postId, assetUrl: p.postAssetUrl ?? p.originalUrl } : {}),
        downloadUrl: getUploadUrl(p.originalUrl),
      }));
      const initialIndex = allPhotos.findIndex((p) => p.id === photo.id);

      navigation.navigate('ImageViewer', {
        urls,
        items,
        initialIndex: initialIndex >= 0 ? initialIndex : 0,
      });
    },
    [allPhotos, navigation]
  );

  const renderRow = useCallback(
    ({ item: row }: { item: PhotoItem[] }) => (
      <PhotoRow row={row} photoSize={photoSize} columns={columns} onPress={handlePhotoTap} />
    ),
    [photoSize, columns, handlePhotoTap]
  );

  const renderSectionHeader = useCallback(
    ({ section: { title } }: { section: { title: string } }) => (
      <View style={styles.monthHeader}>
        <Text style={styles.monthHeaderText}>{title}</Text>
      </View>
    ),
    []
  );

  const rowKeyExtractor = useCallback((item: PhotoItem[]) => item[0].id, []);

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" />

      {/* Header */}
      <View style={styles.header}>
        <Logo size={36} />
        {hasGroups && groups!.length === 1 && (
          <View style={styles.headerTitleWrapper}>
            <Text style={styles.headerGroupName} numberOfLines={1}>
              {groups![0].name}
            </Text>
          </View>
        )}
      </View>

      {/* Group filter chips */}
      {hasGroups && groups!.length > 1 && (
        <View style={styles.filterRow}>
          <FlatList
            horizontal
            data={groups!}
            keyExtractor={(item) => item.id}
            showsHorizontalScrollIndicator={false}
            renderItem={({ item }) => {
              const isActive = activeGroupId === item.id;
              return (
                <TouchableOpacity
                  style={[styles.groupChip, isActive && styles.groupChipActive]}
                  onPress={() => {
                    setSelectedGroupId(item.id);
                    setSelectedPersonId(null);
                  }}
                  accessibilityState={{ selected: isActive }}
                >
                  <Text style={[styles.groupChipText, isActive && styles.groupChipTextActive]}>
                    {item.name}
                  </Text>
                </TouchableOpacity>
              );
            }}
            contentContainerStyle={styles.groupList}
          />
        </View>
      )}

      {/* Person filter chips */}
      {hasGroups && !peopleLoading && people && people.length > 0 && (
        <View style={styles.filterRow}>
          <FlatList
            horizontal
            data={[{ id: null, label: t('photos.allPeople') }, ...people]}
            keyExtractor={(item) => item.id || 'all'}
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
                    {isAll ? item.label : item.label}
                  </Text>
                </TouchableOpacity>
              );
            }}
            contentContainerStyle={styles.personList}
          />
        </View>
      )}

      {/* Photo grid */}
      {!groupsLoaded ? (
        <View style={styles.loadingState}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : hasGroups ? (
        <SectionList
          sections={sectionListData}
          keyExtractor={rowKeyExtractor}
          renderItem={renderRow}
          renderSectionHeader={renderSectionHeader}
          removeClippedSubviews
          initialNumToRender={4}
          maxToRenderPerBatch={4}
          windowSize={7}
          updateCellsBatchingPeriod={50}
          contentContainerStyle={styles.gridContainer}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />
          }
          onEndReached={onEndReached}
          onEndReachedThreshold={0.5}
          ListEmptyComponent={
            isLoading ? (
              <View style={styles.loadingState}>
                <ActivityIndicator size="large" color={colors.primary} />
              </View>
            ) : (
              <EmptyState title={t('photos.emptyTitle')} subtitle={t('photos.emptySubtitle')} />
            )
          }
          ListFooterComponent={
            isFetchingNextPage ? (
              <View style={styles.loadingFooter}>
                <ActivityIndicator size="small" color={colors.primary} />
              </View>
            ) : null
          }
        />
      ) : (
        <EmptyState title={t('feed.noGroupsTitle')} subtitle={t('feed.noGroupsSubtitle')} />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    backgroundColor: colors.white,
    paddingVertical: 10,
    paddingLeft: 16,
    paddingRight: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerTitleWrapper: {
    flex: 1,
    paddingHorizontal: 12,
  },
  headerGroupName: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 16,
    color: colors.textTitle,
  },
  filterRow: {
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  groupList: {
    paddingHorizontal: 12,
    gap: 8,
    alignItems: 'center',
  },
  groupChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 100,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
  },
  groupChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  groupChipText: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 14,
    color: colors.textTitle,
  },
  groupChipTextActive: {
    color: colors.white,
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
  gridContainer: {
    padding: 12,
    paddingBottom: 110,
  },
  gridRow: {
    flexDirection: 'row',
    gap: 4,
    marginBottom: 4,
  },
  photoWrapper: {
    backgroundColor: colors.bg,
    borderRadius: 8,
    overflow: 'hidden',
  },
  photo: {
    width: '100%',
    height: '100%',
  },
  playIconOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
  },
  monthHeader: {
    backgroundColor: colors.bg,
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginTop: 8,
    marginBottom: 4,
  },
  monthHeaderText: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 15,
    color: colors.textTitle,
  },
  loadingFooter: {
    paddingVertical: 20,
    alignItems: 'center',
  },
  loadingState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
});
