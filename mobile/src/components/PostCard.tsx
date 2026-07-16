import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';

import { colors } from '@/constants/colors';
import { Icon } from '@/components/Icon';
import { MediaThumbnail } from '@/components/MediaThumbnail';
import { Avatar } from '@/components/Avatar';
import { PostLocationPreview } from '@/components/PostLocationPreview';
import { ReactionPicker } from '@/components/ReactionPicker';
import { ReactorStack } from '@/components/ReactorStack';
import { Scrim } from '@/components/Scrim';
import { postTypeRenderers } from '@/components/postTypes';
import { Post, PostPerson, ReactionType } from '@/types';
import { REACTION_EMOJI } from '@/constants/reactions';
import { getUploadUrl } from '@/api/uploads';
import { formatRelativeDate } from '@/i18n/utils';
import { useReactToPost, useToggleFavorite } from '@/hooks/usePostMutations';

const AVATAR_COLORS = ['#006e94', '#318ea2', '#4b8b5a', '#005480', '#ed835e'];

function getPersonAvatarInitial(label: string) {
  return label.charAt(0).toUpperCase();
}

function getPersonAvatarColor(label: string) {
  let hash = 0;
  for (let i = 0; i < label.length; i++) {
    hash = label.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function PersonChip({ person }: { person: PostPerson }) {
  const displayName = person.userName || person.label;
  const avatarUrl = person.userAvatarUrl;

  if (avatarUrl) {
    const isExternal = avatarUrl.startsWith('http');
    return (
      <View style={styles.personChip}>
        <MediaThumbnail
          url={isExternal ? avatarUrl : getUploadUrl(avatarUrl, 'thumbnail')}
          fallbackUrl={isExternal ? undefined : getUploadUrl(avatarUrl)}
          style={styles.personAvatar}
        />
        <Text style={styles.personLabel} numberOfLines={1}>
          {person.label}
        </Text>
      </View>
    );
  }

  const initial = getPersonAvatarInitial(person.label);
  const bgColor = getPersonAvatarColor(person.label);

  return (
    <View style={styles.personChip}>
      <View style={[styles.personAvatar, { backgroundColor: bgColor }]}>
        <Text style={styles.personAvatarText}>{initial}</Text>
      </View>
      <Text style={styles.personLabel} numberOfLines={1}>
        {person.label}
      </Text>
    </View>
  );
}

// Memoized so a cache patch from a like/favorite tap (patchPostInCaches
// keeps unaffected posts' identity) only re-renders the affected card, not
// every mounted card in the list.
export const PostCard = React.memo(function PostCard({
  post,
  showGroup = false,
}: {
  post: Post;
  showGroup?: boolean;
}) {
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const isMilestone = post.type === 'MILESTONE';
  const [reactionPickerOpen, setReactionPickerOpen] = useState(false);

  const allPhotoUrls = post.uploadedAssetUrls.map((url) => getUploadUrl(url));
  const fullscreenUrls = allPhotoUrls;

  const likeMutation = useReactToPost(post);

  function selectReaction(type: ReactionType) {
    setReactionPickerOpen(false);
    likeMutation.mutate(type);
  }

  const favoriteMutation = useToggleFavorite(post);

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
  const TypeCardBody = postTypeRenderers[post.type]?.CardBody;
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

        {/* Registry entry for post.type (e.g. POLL) — renders below the
            content above, which for a poll is already the question, so this
            must not repeat it. Unregistered/unknown types render nothing
            extra here, which is the required forward-compat fallback. */}
        {TypeCardBody && <TypeCardBody post={post} />}

        {/* Author-only: present when this post was cross-posted to more than
            one family — the server only includes it for the viewer who
            authored the post. */}
        {!!post.sharedWithGroups && post.sharedWithGroups.length > 1 && (
          <View style={styles.sharedWithRow}>
            <Icon name="share-2" size={12} color={colors.textMuted} />
            <Text style={styles.sharedWithText} numberOfLines={1}>
              {t('feed.sharedWithGroups', {
                names: post.sharedWithGroups.map((g) => g.name).join(', '),
              })}
            </Text>
          </View>
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

        {post.people && post.people.length > 0 && (
          <View
            style={styles.peopleContainer}
            accessible={true}
            accessibilityLabel={t('feed.peopleInPost')}
          >
            {post.people.map((person) => (
              <PersonChip key={person.id} person={person} />
            ))}
          </View>
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
});

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
  sharedWithRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginBottom: 6,
  },
  sharedWithText: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 12,
    color: colors.textMuted,
    flexShrink: 1,
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
  peopleContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
    marginBottom: 4,
  },
  personChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.white,
    borderRadius: 100,
    paddingVertical: 4,
    paddingLeft: 4,
    paddingRight: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  personAvatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.border,
  },
  personAvatarText: {
    fontFamily: 'Nunito_800ExtraBold',
    fontSize: 10,
    color: colors.white,
  },
  personLabel: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 13,
    color: colors.textTitle,
    maxWidth: 120,
  },
});
