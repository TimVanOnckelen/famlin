import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { colors } from '@/constants/colors';
import { Icon } from '@/components/Icon';
import { MediaThumbnail } from '@/components/MediaThumbnail';
import { Avatar } from '@/components/Avatar';
import { PostLocationPreview } from '@/components/PostLocationPreview';
import { ReactionPicker } from '@/components/ReactionPicker';
import { api } from '@/api/client';
import { Post } from '@/types';
import { ReactionType, REACTION_EMOJI } from '@/constants/reactions';
import { getUploadUrl } from '@/api/uploads';
import { formatRelativeDate } from '@/i18n/utils';
import { patchPostInCaches } from '@/utils/postCache';

export function PostCard({ post }: { post: Post }) {
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const queryClient = useQueryClient();
  const isMilestone = post.type === 'MILESTONE';
  const [reactionPickerOpen, setReactionPickerOpen] = useState(false);

  const allPhotoUrls = post.uploadedAssetUrls.map((url) => getUploadUrl(url));
  const fullscreenUrls = allPhotoUrls;

  const likeMutation = useMutation({
    mutationFn: async (type: ReactionType) => {
      const response = await api.post(`/posts/${post.id}/like`, { type });
      return response.data;
    },
    onMutate: async (type) => {
      await queryClient.cancelQueries({ queryKey: ['posts'] });
      await queryClient.cancelQueries({ queryKey: ['post', post.id] });

      const nextReaction = post.myReaction === type ? null : type;
      const patch = (p: Post) => {
        const reactions = { ...p.reactions };
        if (p.myReaction) reactions[p.myReaction] = Math.max(0, (reactions[p.myReaction] || 0) - 1);
        if (nextReaction) reactions[nextReaction] = (reactions[nextReaction] || 0) + 1;
        return {
          ...p,
          myReaction: nextReaction,
          reactions,
          likeCount: Object.values(reactions).reduce((sum, n) => sum + (n || 0), 0),
          likedByMe: nextReaction !== null,
        };
      };

      patchPostInCaches(queryClient, post.id, patch);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['posts'] });
      queryClient.invalidateQueries({ queryKey: ['post', post.id] });
    },
  });

  function selectReaction(type: ReactionType) {
    setReactionPickerOpen(false);
    likeMutation.mutate(type);
  }

  const favoriteMutation = useMutation({
    mutationFn: async () => {
      const response = await api.post(`/posts/${post.id}/favorite`);
      return response.data;
    },
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: ['posts'] });
      await queryClient.cancelQueries({ queryKey: ['post', post.id] });

      const nextFavorited = !post.favoritedByMe;
      const patch = (p: Post) => ({ ...p, favoritedByMe: nextFavorited });

      patchPostInCaches(queryClient, post.id, patch);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['posts'] });
      queryClient.invalidateQueries({ queryKey: ['post', post.id] });
      queryClient.invalidateQueries({ queryKey: ['favorites'] });
    },
  });

  function openFullscreen(index: number) {
    navigation.navigate('ImageViewer', {
      urls: fullscreenUrls,
      assetUrls: post.uploadedAssetUrls,
      postId: post.id,
      initialIndex: index,
    });
  }

  function openDetail() {
    navigation.navigate('PostDetail', { postId: post.id });
  }

  return (
    <View style={[styles.postCard, isMilestone && styles.milestoneCard]}>
      <TouchableOpacity activeOpacity={0.95} onPress={openDetail}>
        {isMilestone && (
          <View style={styles.milestoneBadge}>
            <Text style={styles.milestoneBadgeText}>{t('feed.milestoneBadge')}</Text>
          </View>
        )}

        <View style={styles.authorRow}>
          <Avatar name={post.author.name} avatarUrl={post.author.avatarUrl} size={44} />
          <View style={styles.authorInfo}>
            <Text style={styles.authorName}>{post.author.name}</Text>
            <Text style={styles.postTime}>
              {formatRelativeDate(post.createdAt)}
              {post.editedAt ? ` · ${t('common.edited')}` : ''}
            </Text>
          </View>
          <TouchableOpacity
            onPress={() => favoriteMutation.mutate()}
            disabled={favoriteMutation.isPending}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityLabel={t('feed.favorite')}
          >
            <Icon
              name="bookmark"
              size={20}
              color={post.favoritedByMe ? colors.primary : colors.textMuted}
            />
          </TouchableOpacity>
        </View>

        {isMilestone ? (
          <Text style={styles.milestoneTitle}>{post.content}</Text>
        ) : (
          <Text style={styles.postContent}>{post.content}</Text>
        )}

        {post.latitude != null && post.longitude != null && (
          <PostLocationPreview
            latitude={post.latitude}
            longitude={post.longitude}
            locationName={post.locationName}
            mapHeight={100}
          />
        )}

        {allPhotoUrls.length > 0 && (
          <View style={styles.photoGallery}>
            {allPhotoUrls.slice(0, 3).map((url, index) => (
              <TouchableOpacity
                key={url}
                activeOpacity={0.95}
                style={[
                  styles.photoWrapper,
                  index === 0 && styles.photoWrapperFirst,
                  allPhotoUrls.length === 1 && styles.photoWrapperSingle,
                ]}
                onPress={() => openFullscreen(index)}
              >
                <MediaThumbnail url={url} style={styles.photoImage} />
                {index === 2 && allPhotoUrls.length > 3 && (
                  <View style={styles.photoOverlay}>
                    <Text style={styles.photoOverlayText}>+{allPhotoUrls.length - 3}</Text>
                  </View>
                )}
              </TouchableOpacity>
            ))}
          </View>
        )}
      </TouchableOpacity>

      <View style={[styles.actionsRow, isMilestone && styles.actionsRowMilestone]}>
        <TouchableOpacity
          style={styles.actionButton}
          onPress={() => likeMutation.mutate(post.myReaction ?? 'LIKE')}
          onLongPress={() => setReactionPickerOpen(true)}
          disabled={likeMutation.isPending}
        >
          {post.myReaction ? (
            <Text style={styles.reactionEmoji}>{REACTION_EMOJI[post.myReaction]}</Text>
          ) : (
            <Icon name="heart" size={18} color={colors.textMuted} />
          )}
          <Text style={[styles.actionText, post.myReaction && styles.actionTextActive]}>
            {post.likeCount}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionButton} onPress={openDetail}>
          <Icon name="message-circle" size={18} color={colors.textMuted} />
          <Text style={styles.actionText}>{t('feed.comments', { count: post.commentCount })}</Text>
        </TouchableOpacity>
      </View>

      <ReactionPicker
        visible={reactionPickerOpen}
        onSelect={selectReaction}
        onClose={() => setReactionPickerOpen(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  postCard: {
    backgroundColor: colors.white,
    borderRadius: 18,
    padding: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  milestoneCard: {
    backgroundColor: '#FFF5E6',
    borderWidth: 1.5,
    borderColor: colors.milestone,
  },
  milestoneBadge: {
    marginBottom: 10,
  },
  milestoneBadgeText: {
    fontFamily: 'Nunito_800ExtraBold',
    fontSize: 11,
    color: colors.white,
    backgroundColor: colors.milestone,
    paddingHorizontal: 13,
    paddingVertical: 4,
    borderRadius: 100,
    alignSelf: 'flex-start',
    letterSpacing: 0.3,
  },
  authorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 10,
  },
  authorInfo: {
    flex: 1,
  },
  authorName: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 16,
    color: colors.textTitle,
  },
  postTime: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 2,
  },
  postContent: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 16,
    color: colors.textTitle,
    lineHeight: 24,
    marginBottom: 10,
  },
  milestoneTitle: {
    fontFamily: 'Nunito_900Black',
    fontSize: 22,
    color: colors.textTitle,
    marginBottom: 6,
    letterSpacing: -0.3,
  },
  photoGallery: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 12,
  },
  photoWrapper: {
    flex: 1,
    aspectRatio: 1,
    borderRadius: 12,
    overflow: 'hidden',
  },
  photoWrapperFirst: {
    flex: 2,
  },
  photoWrapperSingle: {
    flex: 1,
    aspectRatio: 16 / 9,
  },
  photoImage: {
    width: '100%',
    height: '100%',
  },
  photoOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoOverlayText: {
    fontFamily: 'Nunito_800ExtraBold',
    fontSize: 20,
    color: colors.white,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 4,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 10,
  },
  actionsRowMilestone: {
    borderTopColor: 'rgba(242, 184, 92, 0.3)',
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
  },
  actionText: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 15,
    color: colors.textMuted,
  },
  actionTextActive: {
    color: colors.primary,
  },
  reactionEmoji: {
    fontSize: 18,
  },
});
