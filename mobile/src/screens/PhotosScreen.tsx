import React, { useState, useMemo } from 'react';
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
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useQuery, useInfiniteQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import i18n from '@/i18n';

import { colors } from '@/constants/colors';
import { Logo } from '@/components/Logo';
import { Icon } from '@/components/Icon';
import { PhotoItem } from '@/types';
import { fetchGroups, getGroupPhotoTimeline, getGroupMediaPeople } from '@famlin/api-client';
import { getUploadUrl } from '@/api/uploads';

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
  const {
    data,
    isLoading,
    isRefetching,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ['photo-timeline', activeGroupId, selectedPersonId],
    queryFn: ({ pageParam }: { pageParam?: string }) =>
      getGroupPhotoTimeline(activeGroupId!, {
        cursor: pageParam,
        personId: selectedPersonId || undefined,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: !!activeGroupId,
  });

  const allPhotos = useMemo(() => {
    return data?.pages.flatMap((page) => page.items) || [];
  }, [data]);

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

  function handlePhotoTap(photo: PhotoItem) {
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
    const initialIndex = allPhotos.findIndex((p) => p.id === photo.id);

    navigation.navigate('ImageViewer', {
      urls,
      initialIndex: initialIndex >= 0 ? initialIndex : 0,
    });
  }

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
      {hasGroups ? (
        <SectionList
          sections={sectionListData}
          keyExtractor={(item, index) => `row-${index}`}
          renderItem={({ item: row }) => (
            <View style={styles.gridRow}>
              {row.map((photo, idx) => (
                <TouchableOpacity
                  key={photo.id}
                  style={[styles.photoWrapper, { width: photoSize, height: photoSize }]}
                  onPress={() => handlePhotoTap(photo)}
                  activeOpacity={0.7}
                >
                  <Image
                    source={{ uri: getUploadUrl(photo.thumbnailUrl) }}
                    style={styles.photo}
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
          )}
          renderSectionHeader={({ section: { title } }) => (
            <View style={styles.monthHeader}>
              <Text style={styles.monthHeaderText}>{title}</Text>
            </View>
          )}
          contentContainerStyle={styles.gridContainer}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />
          }
          onEndReached={() => hasNextPage && !isFetchingNextPage && fetchNextPage()}
          onEndReachedThreshold={0.5}
          ListEmptyComponent={
            !groupsLoaded || (isLoading && !allPhotos.length) ? null : !hasGroups ? (
              <View style={styles.emptyState}>
                <Text style={styles.emptyStateText}>{t('feed.noGroupsTitle')}</Text>
                <Text style={styles.emptyStateSubtext}>{t('feed.noGroupsSubtitle')}</Text>
              </View>
            ) : (
              <View style={styles.emptyState}>
                <Text style={styles.emptyStateText}>{t('photos.emptyTitle')}</Text>
                <Text style={styles.emptyStateSubtext}>{t('photos.emptySubtitle')}</Text>
              </View>
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
      ) : null}
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
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  emptyStateText: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 16,
    color: colors.textTitle,
  },
  emptyStateSubtext: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 14,
    color: colors.textMuted,
    marginTop: 6,
  },
  loadingFooter: {
    paddingVertical: 20,
    alignItems: 'center',
  },
});
