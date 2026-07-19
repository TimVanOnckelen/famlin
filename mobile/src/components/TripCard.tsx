import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';

import { colors } from '@/constants/colors';
import { Icon } from '@/components/Icon';
import { Avatar } from '@/components/Avatar';
import { MediaThumbnail } from '@/components/MediaThumbnail';
import { Post } from '@/types';
import { getUploadUrl } from '@/api/uploads';
import { formatTripDateRange, formatTime } from '@/i18n/utils';
import { useReactToPost } from '@/hooks/usePostMutations';

// The feed card for a TRIP post (design 6a active / 6b closed) — different
// enough from the generic UPDATE/MILESTONE card (gradient frame, its own
// hero source, a "follow/view" CTA instead of the usual comment button) that
// it's a dedicated component PostCard delegates to wholesale, rather than a
// postTypeRenderers registry entry (that registry only appends a body under
// the normal content, see components/postTypes/index.ts).
export function TripCard({ post, showGroup = false }: { post: Post; showGroup?: boolean }) {
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const trip = post.trip;
  const likeMutation = useReactToPost(post);

  if (!trip) return null;

  function openDetail() {
    navigation.navigate('TripDetail', { postId: post.id });
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

  if (trip.closed) {
    return (
      <TouchableOpacity activeOpacity={0.95} onPress={openDetail} style={styles.closedCard}>
        <ClosedCollage photoUrls={trip.collagePhotoUrls} photoCount={trip.photoCount} />
        <View style={styles.body}>
          <View style={styles.badgeRow}>
            <View style={styles.closedBadge}>
              <Text style={styles.closedBadgeText}>{t('feed.trip.closedBadge')}</Text>
            </View>
            {groupTag}
          </View>
          <Text style={styles.title}>{trip.title}</Text>
          {trip.durationDays != null && (
            <Text style={styles.subtitleMuted}>
              {t('feed.trip.closedStats', {
                days: trip.durationDays,
                stops: trip.stopCount,
                photos: trip.photoCount,
              })}
            </Text>
          )}
          {trip.endDate && (
            <Text style={styles.subtitleMuted}>
              {t('feed.trip.authorDateRange', {
                author: post.author.name,
                range: formatTripDateRange(trip.startDate, trip.endDate),
              })}
            </Text>
          )}
          <View style={styles.actionsRow}>
            <TouchableOpacity
              style={styles.likeButtonClosed}
              onPress={toggleLike}
              disabled={likeMutation.isPending}
            >
              <Icon name="heart" size={16} color={post.myReaction ? colors.accent : colors.textMuted} />
              <Text style={styles.likeButtonClosedText}>{post.likeCount}</Text>
            </TouchableOpacity>
            <Text style={styles.ctaTextClosed}>{t('feed.trip.viewDiaryCta')}</Text>
          </View>
        </View>
      </TouchableOpacity>
    );
  }

  const heroUrl = trip.collagePhotoUrls[0] || trip.coverPhotoUrl;

  return (
    <TouchableOpacity activeOpacity={0.95} onPress={openDetail} style={styles.activeCard}>
      <View>
        {heroUrl ? (
          <MediaThumbnail url={getUploadUrl(heroUrl)} style={styles.heroImage} />
        ) : (
          <View style={[styles.heroImage, styles.heroPlaceholder]}>
            <Text style={styles.heroPlaceholderEmoji}>🧳</Text>
          </View>
        )}
        {trip.dayNumber != null && (
          <View style={styles.activeBadge}>
            <Text style={styles.activeBadgeText}>{t('feed.trip.activeBadge', { day: trip.dayNumber })}</Text>
          </View>
        )}
        <View style={styles.authorBadge}>
          <Avatar name={post.author.name} avatarUrl={post.author.avatarUrl} size={34} />
        </View>
      </View>

      <View style={styles.body}>
        <View style={styles.badgeRow}>
          <Text style={styles.title}>{trip.title}</Text>
          {groupTag}
        </View>
        {!!trip.destination && <Text style={styles.destination}>→ {trip.destination}</Text>}

        {trip.latestCheckin && (
          <View style={styles.lastStopRow}>
            <Icon name="map-pin" size={14} color={colors.textBody} />
            <Text style={styles.lastStopText}>
              {t('feed.trip.lastStopLabel')} <Text style={styles.lastStopPlace}>{trip.latestCheckin.place}</Text> ·{' '}
              {formatTime(trip.latestCheckin.createdAt)}
            </Text>
          </View>
        )}

        <Text style={styles.subtitleMuted}>
          {t('feed.trip.stopsSoFar', { count: trip.stopCount, author: post.author.name })}
        </Text>

        <View style={styles.actionsRow}>
          <TouchableOpacity style={styles.likeButtonActive} onPress={toggleLike} disabled={likeMutation.isPending}>
            <Icon name="heart" size={16} color={post.myReaction ? colors.accent : colors.tripDark} />
            <Text style={styles.likeButtonActiveText}>{post.likeCount}</Text>
          </TouchableOpacity>
          <Text style={styles.ctaTextActive}>{t('feed.trip.followCta')}</Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

function ClosedCollage({ photoUrls, photoCount }: { photoUrls: string[]; photoCount: number }) {
  if (photoUrls.length === 0) {
    return (
      <View style={[styles.collageRow, styles.heroPlaceholder]}>
        <Text style={styles.heroPlaceholderEmoji}>🧳</Text>
      </View>
    );
  }

  const stackUrls = photoUrls.slice(1, 3);
  const extraCount = Math.max(0, photoCount - photoUrls.length);

  return (
    <View style={styles.collageRow}>
      <View style={styles.collageMainTile}>
        <MediaThumbnail url={getUploadUrl(photoUrls[0])} style={styles.collageImage} />
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
  activeCard: {
    borderRadius: 22,
    overflow: 'hidden',
    backgroundColor: colors.tripTint,
    borderWidth: 1.5,
    borderColor: colors.tripBorder,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  closedCard: {
    borderRadius: 22,
    overflow: 'hidden',
    backgroundColor: colors.white,
    borderWidth: 1.5,
    borderColor: colors.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  heroImage: {
    width: '100%',
    height: 230,
  },
  heroPlaceholder: {
    backgroundColor: colors.tripTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroPlaceholderEmoji: {
    fontSize: 40,
  },
  activeBadge: {
    position: 'absolute',
    left: 12,
    top: 12,
    backgroundColor: colors.trip,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 100,
  },
  activeBadgeText: {
    fontFamily: 'Nunito_800ExtraBold',
    fontSize: 12.5,
    color: colors.white,
    letterSpacing: 0.2,
  },
  authorBadge: {
    position: 'absolute',
    right: 12,
    top: 12,
  },
  collageRow: {
    flexDirection: 'row',
    height: 190,
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
  closedBadge: {
    borderWidth: 1.5,
    borderColor: colors.tripBorder,
    borderRadius: 100,
    paddingHorizontal: 11,
    paddingVertical: 3,
  },
  closedBadgeText: {
    fontFamily: 'Nunito_800ExtraBold',
    fontSize: 11,
    color: colors.tripDark,
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
  destination: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 14,
    color: colors.tripDark,
    marginTop: 2,
  },
  lastStopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 9,
  },
  lastStopText: {
    fontFamily: 'Nunito_400Regular',
    fontSize: 14.5,
    color: colors.textBody,
    flexShrink: 1,
  },
  lastStopPlace: {
    fontFamily: 'Nunito_700Bold',
  },
  subtitleMuted: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 2,
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.tripBorder,
    paddingTop: 10,
  },
  likeButtonActive: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: colors.tripTint,
    paddingHorizontal: 15,
    paddingVertical: 7,
    borderRadius: 100,
  },
  likeButtonActiveText: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 14,
    color: colors.tripDark,
  },
  likeButtonClosed: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: colors.bg,
    paddingHorizontal: 15,
    paddingVertical: 7,
    borderRadius: 100,
  },
  likeButtonClosedText: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 14,
    color: colors.textBody,
  },
  ctaTextActive: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 14,
    color: colors.tripDark,
    marginLeft: 'auto',
  },
  ctaTextClosed: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 14,
    color: colors.textMuted,
    marginLeft: 'auto',
  },
});
