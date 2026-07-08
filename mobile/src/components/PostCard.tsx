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
import { ReactorStack } from '@/components/ReactorStack';
import { Scrim } from '@/components/Scrim';
import { Post, ReactionType } from '@/types';
import { reactToPost, toggleFavoritePost } from '@famlin/api-client';
import { REACTION_EMOJI } from '@/constants/reactions';
import { getUploadUrl } from '@/api/uploads';
import { formatRelativeDate } from '@/i18n/utils';
import { patchPostInCaches } from '@/utils/postCache';

export function PostCard({ post, showGroup = false }: { post: Post; showGroup?: boolean }) {
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const queryClient = useQueryClient();
  const isMilestone = post.type === 'MILESTONE';
  const [reactionPickerOpen, setReactionPickerOpen] = useState(false);

  const allPhotoUrls = post.uploadedAssetUrls.map((url) => getUploadUrl(url));
  const fullscreenUrls = allPhotoUrls;

  const likeMutation = useMutation({
    mutationFn: (type: ReactionType) => reactToPost(post.id, type),
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
    mutationFn: () => toggleFavoritePost(post.id),
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

  const hasPhotos = allPhotoUrls.length > 0;
  const reactors = post.recentReactors ?? [];
  // Which family this post belongs to — shown when the surrounding list
  // spans several (multi-group feed, favorites).
  const groupTag = showGroup && post.group && (
    <View style={styles.groupTag}>
      <Text style={styles.groupTagText} numberOfLines={1}>
        {post.group.name}
      </Text>
    </View>
  );

  return (
    <View style={[styles.postCard, isMilestone && !hasPhotos && styles.milestoneCard]}>
      {hasPhotos && (
        <View>
          <TouchableOpacity activeOpacity={0.95} onPress={() => openFullscreen(0)}>
            <MediaThumbnail url={allPhotoUrls[0]} style={styles.heroImage} />
          </TouchableOpacity>

          {isMilestone && !!post.content && (
            <View style={styles.heroScrim} pointerEvents="none">
              <Scrim />
              <Text style={styles.heroMilestoneTitle} numberOfLines={2}>
                {post.content}
              </Text>
            </View>
          )}

          <View style={styles.heroTopLeft} pointerEvents="none">
            {isMilestone && (
              <View style={styles.milestoneBadge}>
                <Text style={styles.milestoneBadgeText}>{t('feed.milestoneBadge')}</Text>
              </View>
            )}
            <View style={styles.authorChip}>
              <Avatar name={post.author.name} avatarUrl={post.author.avatarUrl} size={22} />
              <Text style={styles.authorChipName} numberOfLines={1}>
                {post.author.name}
              </Text>
            </View>
          </View>

          <TouchableOpacity
            style={styles.heroBookmark}
            onPress={() => favoriteMutation.mutate()}
            disabled={favoriteMutation.isPending}
            accessibilityLabel={t('feed.favorite')}
          >
            <Icon
              name="bookmark"
              size={16}
              color={post.favoritedByMe ? colors.primary : colors.textMuted}
            />
          </TouchableOpacity>

          {allPhotoUrls.length > 1 && (
            <View style={styles.morePhotosPill} pointerEvents="none">
              <Text style={styles.morePhotosText}>+{allPhotoUrls.length - 1}</Text>
            </View>
          )}
        </View>
      )}

      <TouchableOpacity activeOpacity={0.95} onPress={openDetail} style={styles.cardBody}>
        {!hasPhotos && (
          <>
            {isMilestone && (
              <View style={styles.milestoneBadgeRow}>
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
              {groupTag}
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
          </>
        )}

        {isMilestone ? (
          !hasPhotos && <Text style={styles.milestoneTitle}>{post.content}</Text>
        ) : (
          !!post.content && <Text style={styles.postContent}>{post.content}</Text>
        )}

        {hasPhotos && (
          <View style={styles.metaRow}>
            <Text style={styles.postTime}>
              {formatRelativeDate(post.createdAt)}
              {post.editedAt ? ` · ${t('common.edited')}` : ''}
            </Text>
            {groupTag}
          </View>
        )}

        {post.latitude != null && post.longitude != null && (
          <PostLocationPreview
            latitude={post.latitude}
            longitude={post.longitude}
            locationName={post.locationName}
            mapHeight={100}
          />
        )}
      </TouchableOpacity>

      <View style={[styles.actionsRow, isMilestone && !hasPhotos && styles.actionsRowMilestone]}>
        <TouchableOpacity
          style={styles.actionButton}
          onPress={() => likeMutation.mutate(post.myReaction ?? 'LOVE')}
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
        {reactors.length > 0 && (
          <View style={styles.reactorArea}>
            <ReactorStack reactors={reactors} />
          </View>
        )}
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
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  milestoneCard: {
    backgroundColor: colors.milestoneBg,
    borderWidth: 1.5,
    borderColor: colors.milestone,
  },
  heroImage: {
    width: '100%',
    aspectRatio: 3 / 2,
  },
  heroScrim: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingTop: 40,
    paddingHorizontal: 14,
    paddingBottom: 12,
    justifyContent: 'flex-end',
  },
  heroMilestoneTitle: {
    fontFamily: 'Nunito_900Black',
    fontSize: 23,
    color: colors.white,
    letterSpacing: -0.3,
    paddingRight: 48,
  },
  heroTopLeft: {
    position: 'absolute',
    top: 10,
    left: 10,
    alignItems: 'flex-start',
    gap: 6,
  },
  authorChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderRadius: 100,
    paddingVertical: 3,
    paddingLeft: 3,
    paddingRight: 10,
    maxWidth: 220,
  },
  authorChipName: {
    fontFamily: 'Nunito_800ExtraBold',
    fontSize: 13,
    color: colors.textTitle,
  },
  heroBookmark: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  morePhotosPill: {
    position: 'absolute',
    bottom: 10,
    right: 10,
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderRadius: 100,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  morePhotosText: {
    fontFamily: 'Nunito_800ExtraBold',
    fontSize: 13,
    color: colors.textTitle,
  },
  cardBody: {
    paddingHorizontal: 14,
    paddingTop: 12,
  },
  milestoneBadge: {
    alignSelf: 'flex-start',
  },
  milestoneBadgeRow: {
    marginBottom: 10,
  },
  milestoneBadgeText: {
    fontFamily: 'Nunito_800ExtraBold',
    fontSize: 11,
    color: colors.milestoneText,
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
    fontSize: 17,
    color: colors.textTitle,
  },
  postTime: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 2,
    marginBottom: 8,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  groupTag: {
    backgroundColor: colors.primaryTint,
    borderRadius: 100,
    paddingHorizontal: 10,
    paddingVertical: 3,
    maxWidth: 130,
    marginBottom: 6,
  },
  groupTagText: {
    fontFamily: 'Nunito_800ExtraBold',
    fontSize: 11,
    color: colors.primaryDark,
  },
  postContent: {
    fontFamily: 'Nunito_400Regular',
    fontSize: 17,
    color: colors.textBody,
    lineHeight: 26,
    marginBottom: 6,
  },
  milestoneTitle: {
    fontFamily: 'Nunito_900Black',
    fontSize: 23,
    color: colors.textTitle,
    marginBottom: 6,
    letterSpacing: -0.3,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 4,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 8,
    paddingBottom: 10,
    marginHorizontal: 14,
    marginTop: 4,
  },
  actionsRowMilestone: {
    borderTopColor: colors.milestoneDivider,
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
  reactorArea: {
    marginLeft: 'auto',
    justifyContent: 'center',
  },
  reactionEmoji: {
    fontSize: 18,
  },
});
