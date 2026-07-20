import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { colors } from '@/constants/colors';
import { Icon } from '@/components/Icon';
import { Avatar } from '@/components/Avatar';
import { MediaThumbnail } from '@/components/MediaThumbnail';
import { CheckInComposerModal } from '@/components/CheckInComposerModal';
import { CloseTripSheet } from '@/components/CloseTripSheet';
import { TravelerPickerModal } from '@/components/TravelerPickerModal';
import { Comment, Post, TripEnrichment } from '@/types';
import {
  fetchPost,
  fetchComments,
  createComment,
  reactToComment,
  checkInTrip,
  closeTrip,
  setTripTravelers,
} from '@famlin/api-client';
import { getUploadUrl } from '@/api/uploads';
import { formatTime, formatDayMonth } from '@/i18n/utils';
import { useAuthStore } from '@/stores/authStore';
import { patchPostInCaches } from '@/utils/postCache';
import { splitTripComments, sortCheckins, TripCheckinEntry } from '@/utils/trip';

export function TripDetailScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const route = useRoute<any>();
  const { postId } = route.params;
  const queryClient = useQueryClient();
  const user = useAuthStore((state) => state.user);

  const [commentText, setCommentText] = useState('');
  const [replyingTo, setReplyingTo] = useState<{ id: string; authorName: string } | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [tripCommentsExpanded, setTripCommentsExpanded] = useState(false);
  const [checkinComposerOpen, setCheckinComposerOpen] = useState(false);
  const [closeSheetOpen, setCloseSheetOpen] = useState(false);
  const [travelerPickerOpen, setTravelerPickerOpen] = useState(false);

  const { data: post } = useQuery({
    queryKey: ['post', postId],
    queryFn: () => fetchPost(postId),
  });

  const { data: comments, refetch: refetchComments } = useQuery({
    queryKey: ['comments', postId],
    queryFn: () => fetchComments(postId),
  });

  const trip = post?.trip;

  const { checkins, tripComments, repliesByParent } = useMemo(
    () => (trip ? splitTripComments(comments || [], trip.startDate) : { checkins: [], tripComments: [], repliesByParent: new Map() }),
    [comments, trip]
  );

  const sortedCheckins = useMemo(() => sortCheckins(checkins, !trip?.closed), [checkins, trip?.closed]);

  const checkinMutation = useMutation({
    mutationFn: (data: { place: string; text?: string; photoUrls: string[] }) => checkInTrip(postId, data),
    onSuccess: (updatedPost) => {
      patchPostInCaches(queryClient, postId, () => updatedPost);
      queryClient.invalidateQueries({ queryKey: ['posts'] });
      refetchComments();
      setCheckinComposerOpen(false);
    },
    onError: (err: any) => {
      Alert.alert(t('common.error'), err.response?.data?.error || err.message || t('trip.checkin.alerts.failed'));
    },
  });

  const closeMutation = useMutation({
    mutationFn: () => closeTrip(postId),
    onSuccess: (updatedPost) => {
      patchPostInCaches(queryClient, postId, () => updatedPost);
      queryClient.invalidateQueries({ queryKey: ['posts'] });
      setCloseSheetOpen(false);
    },
    onError: (err: any) => {
      Alert.alert(t('common.error'), err.response?.data?.error || err.message || t('trip.close.alerts.failed'));
    },
  });

  const setTravelersMutation = useMutation({
    mutationFn: (userIds: string[]) => setTripTravelers(postId, userIds),
    onSuccess: (updatedPost) => {
      patchPostInCaches(queryClient, postId, () => updatedPost);
      queryClient.invalidateQueries({ queryKey: ['posts'] });
      setTravelerPickerOpen(false);
    },
    onError: (err: any) => {
      Alert.alert(t('common.error'), err.response?.data?.error || err.message || t('trip.travelers.alerts.failed'));
    },
  });

  const commentMutation = useMutation({
    mutationFn: ({ content, parentId }: { content: string; parentId?: string }) =>
      createComment(postId, { content, parentId }),
    onSuccess: () => {
      setCommentText('');
      setReplyingTo(null);
      refetchComments();
      queryClient.invalidateQueries({ queryKey: ['post', postId] });
      queryClient.invalidateQueries({ queryKey: ['posts'] });
    },
    onError: (err: any) => {
      Alert.alert(t('common.error'), err.response?.data?.error || err.message || t('common.tryAgain'));
    },
  });

  const likeCommentMutation = useMutation({
    mutationFn: (commentId: string) => reactToComment(commentId, 'LIKE'),
    onSuccess: () => refetchComments(),
  });

  if (!post || !trip) return null;

  const isAuthor = post.authorId === user?.id;
  const travelers = trip.travelers ?? [];
  // Check-in permission: the trip author OR a designated co-traveler.
  const canCheckIn = isAuthor || travelers.some((traveler) => traveler.id === user?.id);

  function toggleExpanded(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function startReply(comment: { id: string; author: { name: string } }) {
    setReplyingTo({ id: comment.id, authorName: comment.author.name });
  }

  function submitComment() {
    const trimmed = commentText.trim();
    if (!trimmed) return;
    commentMutation.mutate({ content: trimmed, parentId: replyingTo?.id });
  }

  function openPhotos(urls: string[], index: number) {
    navigation.navigate('ImageViewer', { urls: urls.map((u) => getUploadUrl(u)), initialIndex: index });
  }

  function openMenu() {
    Alert.alert(t('trip.detail.menuButtonLabel'), undefined, [
      { text: t('trip.detail.editTravelersMenuItem'), onPress: () => setTravelerPickerOpen(true) },
      { text: t('trip.detail.closeTripMenuItem'), style: 'destructive', onPress: () => setCloseSheetOpen(true) },
      { text: t('common.cancel'), style: 'cancel' },
    ]);
  }

  const coverUrl = trip.coverPhotoUrl || trip.collagePhotoUrls[0];

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right', 'bottom']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.flex}
        keyboardVerticalOffset={90}
      >
        <FlatList
          data={sortedCheckins}
          keyExtractor={(item) => item.comment.id}
          ListHeaderComponent={
            <TripHeader
              post={post}
              trip={trip}
              coverUrl={coverUrl}
              canCheckIn={canCheckIn}
              hasCheckins={sortedCheckins.length > 0}
              tripComments={tripComments}
              repliesByParent={repliesByParent}
              tripCommentsExpanded={tripCommentsExpanded}
              onToggleTripComments={() => setTripCommentsExpanded((v) => !v)}
              onAddCheckin={() => setCheckinComposerOpen(true)}
              onReplyToComment={startReply}
              onLikeComment={(id) => likeCommentMutation.mutate(id)}
            />
          }
          renderItem={({ item, index }) => (
            <CheckinTimelineItem
              entry={item}
              tripAuthorId={post.authorId}
              isLast={index === sortedCheckins.length - 1}
              closed={trip.closed}
              expanded={expandedIds.has(item.comment.id)}
              onToggleExpanded={() => toggleExpanded(item.comment.id)}
              onLike={() => likeCommentMutation.mutate(item.comment.id)}
              onReply={() => startReply(item.comment)}
              onOpenPhotos={(index2) => openPhotos(item.comment.metadata!.photoUrls, index2)}
            />
          )}
          ListEmptyComponent={
            <TripEmptyState trip={trip} authorName={post.author.name} canCheckIn={canCheckIn} onAddCheckin={() => setCheckinComposerOpen(true)} />
          }
          ListFooterComponent={
            trip.closed ? (
              <Text style={styles.closingLine}>
                {t('trip.detail.closingLine', {
                  author: post.author.name,
                  date: formatDayMonth(trip.closedAt || trip.endDate || trip.startDate),
                })}
              </Text>
            ) : null
          }
          contentContainerStyle={styles.listContent}
        />

        <TouchableOpacity
          style={[styles.floatingBack, { top: insets.top + 8 }]}
          onPress={() => navigation.goBack()}
          accessibilityLabel={t('common.back')}
        >
          <Icon name="arrow-left" size={20} color={colors.textTitle} />
        </TouchableOpacity>

        {isAuthor && !trip.closed && (
          <TouchableOpacity
            style={[styles.floatingMenu, { top: insets.top + 8 }]}
            onPress={openMenu}
            accessibilityLabel={t('trip.detail.menuButtonLabel')}
          >
            <Icon name="more-vertical" size={20} color={colors.textTitle} />
          </TouchableOpacity>
        )}

        {replyingTo && (
          <View style={styles.replyingBar}>
            <Text style={styles.replyingBarText}>{t('postDetail.replyingTo', { name: replyingTo.authorName })}</Text>
            <TouchableOpacity onPress={() => setReplyingTo(null)}>
              <Text style={styles.replyingBarCancel}>{t('postDetail.cancelReply')}</Text>
            </TouchableOpacity>
          </View>
        )}

        <View style={styles.inputContainer}>
          <Avatar name={user?.name || '?'} avatarUrl={user?.avatarUrl} size={36} />
          <TextInput
            style={styles.input}
            placeholder={replyingTo ? t('postDetail.replyPlaceholder') : t('postDetail.commentPlaceholder')}
            placeholderTextColor={colors.textMuted}
            value={commentText}
            onChangeText={setCommentText}
            multiline
          />
          <TouchableOpacity
            style={[styles.sendButton, !commentText.trim() && styles.sendButtonDisabled]}
            onPress={submitComment}
            disabled={!commentText.trim() || commentMutation.isPending}
          >
            <Icon name="send" size={18} color={colors.white} />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      <CheckInComposerModal
        visible={checkinComposerOpen}
        tripTitle={trip.title}
        dayNumber={trip.dayNumber ?? 1}
        submitting={checkinMutation.isPending}
        onCancel={() => setCheckinComposerOpen(false)}
        onSubmit={(data) => checkinMutation.mutate(data)}
      />

      <CloseTripSheet
        visible={closeSheetOpen}
        tripTitle={trip.title}
        submitting={closeMutation.isPending}
        onCancel={() => setCloseSheetOpen(false)}
        onConfirm={() => closeMutation.mutate()}
      />

      <TravelerPickerModal
        visible={travelerPickerOpen}
        groupIds={(post.sharedWithGroups ?? [{ id: post.groupId }]).map((group) => group.id)}
        excludeUserId={post.authorId}
        initialSelectedIds={travelers.map((traveler) => traveler.id)}
        submitting={setTravelersMutation.isPending}
        onCancel={() => setTravelerPickerOpen(false)}
        onConfirm={(userIds) => setTravelersMutation.mutate(userIds)}
      />
    </SafeAreaView>
  );
}

function TripHeader({
  post,
  trip,
  coverUrl,
  canCheckIn,
  hasCheckins,
  tripComments,
  repliesByParent,
  tripCommentsExpanded,
  onToggleTripComments,
  onAddCheckin,
  onReplyToComment,
  onLikeComment,
}: {
  post: Post;
  trip: TripEnrichment;
  coverUrl: string | null | undefined;
  canCheckIn: boolean;
  hasCheckins: boolean;
  tripComments: Comment[];
  repliesByParent: Map<string, Comment[]>;
  tripCommentsExpanded: boolean;
  onToggleTripComments: () => void;
  onAddCheckin: () => void;
  onReplyToComment: (comment: { id: string; author: { name: string } }) => void;
  onLikeComment: (id: string) => void;
}) {
  const { t } = useTranslation();
  const travelers = trip.travelers ?? [];

  return (
    <View>
      <View style={styles.coverWrapper}>
        {coverUrl ? (
          <MediaThumbnail url={getUploadUrl(coverUrl)} style={styles.cover} />
        ) : (
          <View style={[styles.cover, styles.coverPlaceholder]}>
            <Text style={styles.coverPlaceholderEmoji}>🧳</Text>
          </View>
        )}
        {trip.closed && <View style={styles.coverDim} pointerEvents="none" />}
      </View>

      <View style={styles.card}>
        <View style={trip.closed ? styles.closedBadge : styles.activeBadge}>
          <Text style={trip.closed ? styles.closedBadgeText : styles.activeBadgeText}>
            {trip.closed ? t('trip.detail.closedBadge') : t('trip.detail.activeBadge', { day: trip.dayNumber ?? 1 })}
          </Text>
        </View>
        <Text style={styles.title}>{trip.title}</Text>
        {!!trip.destination && <Text style={styles.destination}>→ {trip.destination}</Text>}

        {!trip.closed ? (
          <View style={styles.authorRow}>
            <Avatar name={post.author.name} avatarUrl={post.author.avatarUrl} size={30} />
            <Text style={styles.authorRowText}>
              {t('trip.detail.sinceLabel', { author: post.author.name, date: formatDayMonth(trip.startDate) })}
            </Text>
          </View>
        ) : (
          <View style={styles.statsGrid}>
            <View style={styles.statCell}>
              <Text style={styles.statNumber}>{trip.stopCount}</Text>
              <Text style={styles.statLabel}>{t('trip.detail.statsStops')}</Text>
            </View>
            <View style={styles.statCell}>
              <Text style={styles.statNumber}>{trip.photoCount}</Text>
              <Text style={styles.statLabel}>{t('trip.detail.statsPhotos')}</Text>
            </View>
            <View style={styles.statCell}>
              <Text style={styles.statNumber}>{trip.durationDays ?? 0}</Text>
              <Text style={styles.statLabel}>{t('trip.detail.statsDays')}</Text>
            </View>
          </View>
        )}

        {travelers.length > 0 && (
          <View
            style={styles.travelersRow}
            accessible={true}
            accessibilityLabel={t('trip.detail.travelersRowLabel')}
          >
            <View style={styles.travelersStack}>
              {travelers.slice(0, 5).map((traveler, index) => (
                <View key={traveler.id} style={[styles.travelerFace, index > 0 && styles.travelerFaceOverlap]}>
                  <Avatar name={traveler.name} avatarUrl={traveler.avatarUrl} size={24} />
                </View>
              ))}
            </View>
            <Text style={styles.travelersText} numberOfLines={1}>
              {t('trip.detail.travelersWith', { names: travelers.map((traveler) => traveler.name).join(', ') })}
            </Text>
          </View>
        )}
      </View>

      <View style={styles.tripCommentsSection}>
        <TouchableOpacity style={styles.tripCommentsHeader} onPress={onToggleTripComments}>
          <Text style={styles.tripCommentsTitle}>
            {t('trip.detail.tripCommentsSectionTitle', { count: tripComments.length })}
          </Text>
          <Icon name={tripCommentsExpanded ? 'chevron-up' : 'chevron-down'} size={14} color={colors.textMuted} />
        </TouchableOpacity>
        {tripCommentsExpanded &&
          tripComments.map((comment) => (
            <TripCommentRow
              key={comment.id}
              comment={comment}
              replies={repliesByParent.get(comment.id) || []}
              onReply={() => onReplyToComment(comment)}
              onLike={() => onLikeComment(comment.id)}
            />
          ))}
        {tripCommentsExpanded && tripComments.length === 0 && (
          <Text style={styles.tripCommentsEmpty}>{t('postDetail.commentsHeader', { count: 0 })}</Text>
        )}
      </View>

      {hasCheckins && canCheckIn && !trip.closed && (
        <View style={styles.addCheckinRow}>
          <TouchableOpacity style={styles.addCheckinButton} onPress={onAddCheckin}>
            <Text style={styles.addCheckinButtonText}>{t('trip.detail.addCheckinButton')}</Text>
          </TouchableOpacity>
        </View>
      )}

      {hasCheckins && (
        <Text style={styles.timelineLabel}>
          {trip.closed ? t('trip.detail.timelineLabelClosed') : t('trip.detail.timelineLabelActive')}
        </Text>
      )}
    </View>
  );
}

function TripCommentRow({
  comment,
  replies,
  onReply,
  onLike,
}: {
  comment: Comment;
  replies: Comment[];
  onReply: () => void;
  onLike: () => void;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.tripCommentRow}>
      <Avatar name={comment.author.name} avatarUrl={comment.author.avatarUrl} size={28} />
      <View style={styles.tripCommentBody}>
        <Text style={styles.tripCommentText}>
          <Text style={styles.tripCommentAuthor}>{comment.author.name}</Text> · {comment.content}
        </Text>
        <View style={styles.tripCommentActions}>
          <TouchableOpacity onPress={onLike}>
            <Text style={styles.tripCommentAction}>
              {comment.likeCount > 0 ? `❤️ ${comment.likeCount}` : t('postDetail.like')}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onReply}>
            <Text style={styles.tripCommentAction}>{t('postDetail.reply')}</Text>
          </TouchableOpacity>
        </View>
        {replies.map((reply) => (
          <View key={reply.id} style={styles.tripCommentReply}>
            <Avatar name={reply.author.name} avatarUrl={reply.author.avatarUrl} size={22} />
            <Text style={styles.tripCommentText}>
              <Text style={styles.tripCommentAuthor}>{reply.author.name}</Text> · {reply.content}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function TripEmptyState({
  trip,
  authorName,
  canCheckIn,
  onAddCheckin,
}: {
  trip: TripEnrichment;
  authorName: string;
  canCheckIn: boolean;
  onAddCheckin: () => void;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.emptyState}>
      <View style={styles.emptyIconCircle}>
        <Text style={styles.emptyIconEmoji}>🧳</Text>
      </View>
      <Text style={styles.emptyTitle}>{t('trip.detail.emptyTitle')}</Text>
      <Text style={styles.emptyDescription}>{t('trip.detail.emptyDescription', { name: authorName })}</Text>
      {canCheckIn && !trip.closed && (
        <TouchableOpacity style={styles.addCheckinButton} onPress={onAddCheckin}>
          <Text style={styles.addCheckinButtonText}>{t('trip.detail.addCheckinButton')}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

function CheckinTimelineItem({
  entry,
  tripAuthorId,
  isLast,
  closed,
  expanded,
  onToggleExpanded,
  onLike,
  onReply,
  onOpenPhotos,
}: {
  entry: TripCheckinEntry;
  tripAuthorId: string;
  isLast: boolean;
  closed: boolean;
  expanded: boolean;
  onToggleExpanded: () => void;
  onLike: () => void;
  onReply: () => void;
  onOpenPhotos: (index: number) => void;
}) {
  const { t } = useTranslation();
  const { comment, dayNumber, replies } = entry;
  const metadata = comment.metadata!;
  const photoUrls = metadata.photoUrls || [];
  // A co-traveler's check-in gets attributed explicitly; the trip author's
  // own check-ins don't repeat their name on every entry (the header already
  // names them).
  const isCoTravelerCheckin = comment.authorId !== tripAuthorId;

  return (
    <View style={styles.timelineRow}>
      <View style={styles.timelineConnector}>
        <View style={styles.timelineDot} />
        {!isLast && <View style={styles.timelineLine} />}
      </View>
      <View style={styles.timelineContent}>
        <Text style={styles.timelineDayLabel}>
          {closed
            ? t('trip.detail.dayDateLabel', { day: dayNumber, date: formatDayMonth(comment.createdAt) })
            : t('trip.detail.dayTimeLabel', { day: dayNumber, time: formatTime(comment.createdAt) })}
        </Text>
        <Text style={styles.timelinePlace}>{metadata.place}</Text>
        {isCoTravelerCheckin && (
          <View style={styles.timelineAuthorRow}>
            <Avatar name={comment.author.name} avatarUrl={comment.author.avatarUrl} size={20} />
            <Text style={styles.timelineAuthorName} numberOfLines={1}>
              {comment.author.name}
            </Text>
          </View>
        )}
        {!!comment.content && <Text style={styles.timelineText}>{comment.content}</Text>}

        {photoUrls.length > 0 && (
          <View style={photoUrls.length === 1 ? styles.timelinePhotoSingle : styles.timelinePhotoGrid}>
            {photoUrls.map((url, index) => (
              <TouchableOpacity
                key={url}
                style={photoUrls.length === 1 ? styles.timelinePhotoTileSingle : styles.timelinePhotoTile}
                activeOpacity={0.9}
                onPress={() => onOpenPhotos(index)}
              >
                <MediaThumbnail url={getUploadUrl(url, 'thumbnail')} fallbackUrl={getUploadUrl(url)} style={styles.timelinePhotoImage} />
              </TouchableOpacity>
            ))}
          </View>
        )}

        <View style={styles.timelineFooter}>
          <TouchableOpacity onPress={onLike} style={styles.timelineLikeButton}>
            <Text style={styles.timelineLikeText}>{t('trip.detail.likesLabel', { count: comment.likeCount })}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onToggleExpanded}>
            <Text style={styles.timelineRepliesButton}>
              {t('trip.detail.commentsCountButton', { count: replies.length })}
            </Text>
          </TouchableOpacity>
        </View>

        {expanded && (
          <View style={styles.timelineReplies}>
            {replies.map((reply) => (
              <View key={reply.id} style={styles.timelineReplyRow}>
                <Avatar name={reply.author.name} avatarUrl={reply.author.avatarUrl} size={22} />
                <Text style={styles.tripCommentText}>
                  <Text style={styles.tripCommentAuthor}>{reply.author.name}</Text> · {reply.content}
                </Text>
              </View>
            ))}
            <TouchableOpacity onPress={onReply}>
              <Text style={styles.timelineReplyAction}>{t('postDetail.reply')}</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.white,
  },
  flex: {
    flex: 1,
  },
  listContent: {
    paddingBottom: 24,
  },
  coverWrapper: {
    position: 'relative',
  },
  cover: {
    width: '100%',
    height: 190,
  },
  coverPlaceholder: {
    backgroundColor: colors.tripTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  coverPlaceholderEmoji: {
    fontSize: 48,
  },
  coverDim: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(60,60,65,0.2)',
  },
  card: {
    marginTop: -28,
    marginHorizontal: 12,
    backgroundColor: colors.white,
    borderRadius: 18,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.1,
    shadowRadius: 20,
    elevation: 4,
  },
  activeBadge: {
    alignSelf: 'flex-start',
    backgroundColor: colors.trip,
    borderRadius: 100,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  activeBadgeText: {
    fontFamily: 'Nunito_800ExtraBold',
    fontSize: 11,
    color: colors.white,
  },
  closedBadge: {
    alignSelf: 'flex-start',
    borderWidth: 1.5,
    borderColor: colors.tripBorder,
    borderRadius: 100,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  closedBadgeText: {
    fontFamily: 'Nunito_800ExtraBold',
    fontSize: 11,
    color: colors.tripDark,
  },
  title: {
    fontFamily: 'Nunito_900Black',
    fontSize: 22,
    color: colors.textTitle,
    letterSpacing: -0.3,
    marginTop: 8,
  },
  destination: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 14.5,
    color: colors.tripDark,
    marginTop: 2,
  },
  authorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 10,
  },
  authorRowText: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 14,
    color: colors.textMuted,
  },
  statsGrid: {
    flexDirection: 'row',
    marginTop: 14,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 12,
  },
  statCell: {
    flex: 1,
    alignItems: 'center',
  },
  statNumber: {
    fontFamily: 'Nunito_900Black',
    fontSize: 18,
    color: colors.textTitle,
  },
  statLabel: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 11.5,
    color: colors.textMuted,
    marginTop: 2,
  },
  travelersRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 10,
  },
  travelersStack: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  travelerFace: {
    borderWidth: 2,
    borderColor: colors.white,
    borderRadius: 14,
  },
  travelerFaceOverlap: {
    marginLeft: -8,
  },
  travelersText: {
    flex: 1,
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 13,
    color: colors.textMuted,
  },
  tripCommentsSection: {
    marginTop: 14,
    marginHorizontal: 12,
    backgroundColor: colors.bg,
    borderRadius: 14,
    padding: 12,
  },
  tripCommentsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  tripCommentsTitle: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 13.5,
    color: colors.textMuted,
  },
  tripCommentsEmpty: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 8,
  },
  tripCommentRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
  },
  tripCommentBody: {
    flex: 1,
  },
  tripCommentText: {
    fontFamily: 'Nunito_400Regular',
    fontSize: 14,
    color: colors.textBody,
    lineHeight: 20,
  },
  tripCommentAuthor: {
    fontFamily: 'Nunito_700Bold',
    color: colors.textTitle,
  },
  tripCommentActions: {
    flexDirection: 'row',
    gap: 14,
    marginTop: 3,
  },
  tripCommentAction: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 12,
    color: colors.textMuted,
  },
  tripCommentReply: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
    marginLeft: 8,
  },
  addCheckinRow: {
    marginTop: 14,
    marginHorizontal: 12,
  },
  addCheckinButton: {
    height: 48,
    borderRadius: 100,
    backgroundColor: colors.trip,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.trip,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 14,
    elevation: 3,
    paddingHorizontal: 28,
  },
  addCheckinButtonText: {
    fontFamily: 'Nunito_800ExtraBold',
    fontSize: 15,
    color: colors.white,
  },
  timelineLabel: {
    fontFamily: 'Nunito_800ExtraBold',
    fontSize: 12,
    color: colors.textMuted,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginTop: 22,
    marginHorizontal: 16,
    marginBottom: 6,
  },
  timelineRow: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 16,
  },
  timelineConnector: {
    width: 14,
    alignItems: 'center',
    paddingTop: 4,
  },
  timelineDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: colors.trip,
  },
  timelineLine: {
    width: 2,
    flex: 1,
    backgroundColor: colors.tripBorder,
    marginTop: 4,
  },
  timelineContent: {
    flex: 1,
    paddingBottom: 22,
  },
  timelineDayLabel: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 13,
    color: colors.tripDark,
  },
  timelinePlace: {
    fontFamily: 'Nunito_800ExtraBold',
    fontSize: 17,
    color: colors.textTitle,
    marginTop: 2,
  },
  timelineAuthorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
  },
  timelineAuthorName: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 13,
    color: colors.textMuted,
    flexShrink: 1,
  },
  timelineText: {
    fontFamily: 'Nunito_400Regular',
    fontSize: 15,
    color: colors.textBody,
    lineHeight: 22,
    marginTop: 4,
  },
  timelinePhotoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 8,
  },
  timelinePhotoTile: {
    width: '48%',
    height: 90,
    borderRadius: 10,
    overflow: 'hidden',
  },
  timelinePhotoSingle: {
    marginTop: 8,
  },
  timelinePhotoTileSingle: {
    width: '100%',
    height: 130,
    borderRadius: 10,
    overflow: 'hidden',
  },
  timelinePhotoImage: {
    width: '100%',
    height: '100%',
  },
  timelineFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 8,
  },
  timelineLikeButton: {},
  timelineLikeText: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 13.5,
    color: colors.textMuted,
  },
  timelineRepliesButton: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 13.5,
    color: colors.textMuted,
  },
  timelineReplies: {
    marginTop: 8,
    marginLeft: 4,
    gap: 8,
  },
  timelineReplyRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-start',
  },
  timelineReplyAction: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 12.5,
    color: colors.trip,
  },
  closingLine: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 13,
    color: colors.textMuted,
    textAlign: 'center',
    backgroundColor: colors.bg,
    marginHorizontal: 16,
    marginTop: 4,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    paddingVertical: 48,
    gap: 14,
  },
  emptyIconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.tripTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyIconEmoji: {
    fontSize: 28,
  },
  emptyTitle: {
    fontFamily: 'Nunito_800ExtraBold',
    fontSize: 17,
    color: colors.textTitle,
    textAlign: 'center',
  },
  emptyDescription: {
    fontFamily: 'Nunito_400Regular',
    fontSize: 15,
    color: colors.textMuted,
    lineHeight: 22,
    textAlign: 'center',
  },
  floatingBack: {
    position: 'absolute',
    left: 16,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 5,
  },
  floatingMenu: {
    position: 'absolute',
    right: 16,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 5,
  },
  replyingBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: colors.bg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  replyingBarText: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 13,
    color: colors.textMuted,
  },
  replyingBarCancel: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 13,
    color: colors.primary,
  },
  inputContainer: {
    backgroundColor: colors.white,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 10,
    paddingBottom: 30,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  input: {
    flex: 1,
    backgroundColor: colors.bg,
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 16,
    color: colors.textTitle,
    borderWidth: 1,
    borderColor: colors.border,
    maxHeight: 100,
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.trip,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonDisabled: {
    backgroundColor: colors.border,
  },
});
