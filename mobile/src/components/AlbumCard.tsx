import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { colors } from '@/constants/colors';
import { Icon } from '@/components/Icon';
import { Avatar } from '@/components/Avatar';
import { MediaThumbnail } from '@/components/MediaThumbnail';
import { AddAlbumPhotosModal } from '@/components/AddAlbumPhotosModal';
import { Post } from '@/types';
import { addAlbumPhotos } from '@famlin/api-client';
import { getUploadUrl } from '@/api/uploads';
import { patchPostInCaches } from '@/utils/postCache';
import { useReactToPost } from '@/hooks/usePostMutations';

// The feed card for an ALBUM post — a collaborative photo album any group
// member adds photos to. Like TripCard it's a wholesale-different card
// (collage hero, contributor stack, an "Add photos"/"Open album" CTA) that
// PostCard delegates to for post.type === 'ALBUM', rather than a
// postTypeRenderers registry entry. Mirrors web's AlbumFeedCard.
export function AlbumCard({ post, showGroup = false }: { post: Post; showGroup?: boolean }) {
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const queryClient = useQueryClient();
  const album = post.album;
  const likeMutation = useReactToPost(post);
  const [contributeOpen, setContributeOpen] = useState(false);

  const contributeMutation = useMutation({
    mutationFn: (data: { photoUrls: string[]; caption?: string }) => addAlbumPhotos(post.id, data),
    onSuccess: (updatedPost) => {
      patchPostInCaches(queryClient, post.id, () => updatedPost);
      queryClient.invalidateQueries({ queryKey: ['posts'] });
      queryClient.invalidateQueries({ queryKey: ['comments', post.id] });
      setContributeOpen(false);
    },
    onError: (err: any) => {
      Alert.alert(t('common.error'), err.response?.data?.error || err.message || t('album.addPhotos.alerts.failed'));
    },
  });

  if (!album) return null;

  function openDetail() {
    navigation.navigate('AlbumDetail', { postId: post.id });
  }

  function toggleLike() {
    likeMutation.mutate(post.myReaction ?? 'LOVE');
  }

  const groupTag = showGroup && post.group && (
    <View style={styles.groupTag}>
      <Text style={styles.groupTagText} numberOfLines={1}>
        {post.group.name}
      </Text>
    </View>
  );

  return (
    <View style={styles.card}>
      <TouchableOpacity activeOpacity={0.95} onPress={openDetail}>
        <AlbumCollage collagePhotoUrls={album.collagePhotoUrls} coverPhotoUrl={album.coverPhotoUrl} photoCount={album.photoCount} />
      </TouchableOpacity>

      <View style={styles.body}>
        <View style={styles.badgeRow}>
          <View style={album.closed ? styles.closedBadge : styles.badge}>
            <Text style={album.closed ? styles.closedBadgeText : styles.badgeText}>
              {album.closed ? t('feed.album.closedBadge') : t('feed.album.badge')}
            </Text>
          </View>
          {groupTag}
        </View>

        <TouchableOpacity onPress={openDetail}>
          <Text style={styles.title}>{album.title}</Text>
        </TouchableOpacity>
        <Text style={styles.subtitleMuted}>
          {t('feed.album.stats', { photos: album.photoCount, contributors: album.contributorCount })}
        </Text>

        {album.contributors.length > 0 && (
          <View style={styles.contributorRow}>
            <View style={styles.contributorStack}>
              {album.contributors.slice(0, 5).map((contributor, i) => (
                <View key={contributor.id} style={[styles.contributorFace, i > 0 && styles.contributorFaceOverlap]}>
                  <Avatar name={contributor.name} avatarUrl={contributor.avatarUrl} size={26} />
                </View>
              ))}
            </View>
            <Text style={styles.contributorText} numberOfLines={1}>
              {t('feed.album.contributedBy', {
                name: album.contributors[0].name,
                count: album.contributorCount,
                others: album.contributorCount - 1,
              })}
            </Text>
          </View>
        )}

        <View style={styles.actionsRow}>
          <TouchableOpacity style={styles.likeButton} onPress={toggleLike} disabled={likeMutation.isPending}>
            <Icon name="heart" size={16} color={post.myReaction ? colors.accent : colors.primaryDark} />
            <Text style={styles.likeButtonText}>{post.likeCount}</Text>
          </TouchableOpacity>
          {!album.closed && (
            <TouchableOpacity style={styles.addButton} onPress={() => setContributeOpen(true)}>
              <Icon name="plus" size={15} color={colors.primaryDark} />
              <Text style={styles.addButtonText}>{t('feed.album.addPhotosCta')}</Text>
            </TouchableOpacity>
          )}
          <Text style={styles.ctaText} onPress={openDetail}>
            {t('feed.album.openCta')}
          </Text>
        </View>
      </View>

      <AddAlbumPhotosModal
        visible={contributeOpen}
        albumTitle={album.title}
        submitting={contributeMutation.isPending}
        onCancel={() => setContributeOpen(false)}
        onSubmit={(data) => contributeMutation.mutate(data)}
      />
    </View>
  );
}

function AlbumCollage({
  collagePhotoUrls,
  coverPhotoUrl,
  photoCount,
}: {
  collagePhotoUrls: string[];
  coverPhotoUrl: string | null;
  photoCount: number;
}) {
  const urls = collagePhotoUrls.length > 0 ? collagePhotoUrls : coverPhotoUrl ? [coverPhotoUrl] : [];

  if (urls.length === 0) {
    return (
      <View style={[styles.collageRow, styles.heroPlaceholder]}>
        <Text style={styles.heroPlaceholderEmoji}>🖼️</Text>
      </View>
    );
  }

  const stackUrls = urls.slice(1, 3);
  const extraCount = Math.max(0, photoCount - urls.slice(0, 3).length);

  return (
    <View style={styles.collageRow}>
      <View style={styles.collageMainTile}>
        <MediaThumbnail url={getUploadUrl(urls[0])} style={styles.collageImage} />
      </View>
      {stackUrls.length > 0 && (
        <View style={styles.collageStack}>
          {stackUrls.map((url, i) => (
            <View key={url} style={styles.collageStackTile}>
              <MediaThumbnail url={getUploadUrl(url)} style={styles.collageImage} />
              {i === stackUrls.length - 1 && extraCount > 0 && (
                <View style={styles.collageMoreOverlay} pointerEvents="none">
                  <Text style={styles.collageMoreText}>+{extraCount}</Text>
                </View>
              )}
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 22,
    overflow: 'hidden',
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.primaryTint,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  heroPlaceholder: {
    backgroundColor: colors.primaryTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroPlaceholderEmoji: {
    fontSize: 40,
  },
  collageRow: {
    flexDirection: 'row',
    height: 200,
    gap: 2,
  },
  collageMainTile: {
    flex: 1.5,
  },
  collageStack: {
    flex: 1,
    gap: 2,
  },
  collageStackTile: {
    flex: 1,
  },
  collageImage: {
    width: '100%',
    height: '100%',
  },
  collageMoreOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(20,20,25,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  collageMoreText: {
    fontFamily: 'Nunito_800ExtraBold',
    fontSize: 15,
    color: colors.white,
  },
  body: {
    paddingHorizontal: 16,
    paddingTop: 13,
    paddingBottom: 14,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  badge: {
    backgroundColor: colors.primary,
    borderRadius: 100,
    paddingHorizontal: 11,
    paddingVertical: 3,
  },
  badgeText: {
    fontFamily: 'Nunito_800ExtraBold',
    fontSize: 11,
    color: colors.white,
  },
  closedBadge: {
    borderWidth: 1.5,
    borderColor: colors.primaryTint,
    borderRadius: 100,
    paddingHorizontal: 11,
    paddingVertical: 3,
  },
  closedBadgeText: {
    fontFamily: 'Nunito_800ExtraBold',
    fontSize: 11,
    color: colors.primaryDark,
  },
  groupTag: {
    backgroundColor: colors.primaryTint,
    borderRadius: 100,
    paddingHorizontal: 10,
    paddingVertical: 3,
    maxWidth: 130,
  },
  groupTagText: {
    fontFamily: 'Nunito_800ExtraBold',
    fontSize: 11,
    color: colors.primaryDark,
  },
  title: {
    fontFamily: 'Nunito_900Black',
    fontSize: 18,
    color: colors.textTitle,
    letterSpacing: -0.3,
    marginTop: 8,
  },
  subtitleMuted: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 2,
  },
  contributorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
  },
  contributorStack: {
    flexDirection: 'row',
  },
  contributorFace: {
    borderRadius: 13,
    borderWidth: 2,
    borderColor: colors.surface,
  },
  contributorFaceOverlap: {
    marginLeft: -8,
  },
  contributorText: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 13,
    color: colors.textMuted,
    flexShrink: 1,
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.primaryTint,
    paddingTop: 10,
  },
  likeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: colors.primaryTint,
    paddingHorizontal: 15,
    paddingVertical: 7,
    borderRadius: 100,
  },
  likeButtonText: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 14,
    color: colors.primaryDark,
  },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: 1.5,
    borderColor: colors.primary,
    paddingHorizontal: 13,
    paddingVertical: 6,
    borderRadius: 100,
  },
  addButtonText: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 13,
    color: colors.primaryDark,
  },
  ctaText: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 14,
    color: colors.primaryDark,
    marginLeft: 'auto',
  },
});
