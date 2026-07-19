import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Comment,
  fetchPost,
  fetchComments,
  createComment,
  reactToComment,
  getUploadUrl,
  patchPostInCaches,
} from '@famlin/api-client';
import { Avatar } from '@/components/Avatar';
import { BottomNav } from '@/components/BottomNav';
import { CommentsSection } from '@/components/CommentsSection';
import { Lightbox } from '@/components/Lightbox';
import { ShimmerImage } from '@/components/ShimmerImage';
import { isVideoUrl } from '@/utils/media';
import { formatDayMonth, formatTime } from '@/utils/time';
import { splitTripComments, sortCheckins, TripCheckinEntry } from '@/utils/trip';
import './TripDetailPage.css';

// Web's counterpart of mobile's TripDetailScreen — VIEWING ONLY (see
// design/trip-tracker-brief.md and CLAUDE.md's web/ bullet on no
// client-side routing): a `view` state in App.tsx opens this the same way
// it opens ProfilePage/ChatPage, since a trip isn't a tab of its own.
// Composing check-ins, closing the trip, and editing travelers are
// deliberately not here — those stay mobile/backend-only for now; this page
// only reads post.trip + the post's comments (splitting check-ins from
// trip-level comments client-side, see utils/trip.ts) and lets members
// react to / reply on individual check-ins and comment on the trip overall.
export function TripDetailPage({
  postId,
  onBack,
  onOpenPhotos,
  onOpenChat,
  onOpenProfile,
}: {
  postId: string;
  onBack: () => void;
  onOpenPhotos?: () => void;
  onOpenChat?: () => void;
  onOpenProfile?: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [lightbox, setLightbox] = useState<{ urls: string[]; index: number } | null>(null);

  const postQuery = useQuery({ queryKey: ['post', postId], queryFn: () => fetchPost(postId) });
  // Same ['comments', postId] key CommentsSection itself queries — sharing it
  // means the "Reacties op de reis" section below reuses this fetch from the
  // cache instead of firing a second request.
  const commentsQuery = useQuery({ queryKey: ['comments', postId], queryFn: () => fetchComments(postId) });

  const post = postQuery.data;
  const trip = post?.trip;
  const comments = commentsQuery.data ?? [];

  const { checkins, tripComments } = useMemo(
    () => (trip ? splitTripComments(comments, trip.startDate) : { checkins: [], tripComments: [], repliesByParent: new Map() }),
    [comments, trip]
  );
  const sortedCheckins = useMemo(() => sortCheckins(checkins, !trip?.closed), [checkins, trip?.closed]);

  if (postQuery.isLoading || commentsQuery.isLoading) {
    return (
      <div className="trip-detail-shell">
        <main className="trip-detail-column">
          <BackLink onBack={onBack} />
          <div className="trip-detail-hint">{t('common.loading')}</div>
        </main>
      </div>
    );
  }

  if (!post || !trip) {
    return (
      <div className="trip-detail-shell">
        <main className="trip-detail-column">
          <BackLink onBack={onBack} />
          <div className="trip-detail-hint">{t('feed.loadFailed')}</div>
        </main>
      </div>
    );
  }

  const coverUrl = trip.coverPhotoUrl || trip.collagePhotoUrls[0] || null;
  const travelers = trip.travelers ?? [];

  return (
    <div className="trip-detail-shell">
      <main className="trip-detail-column">
        <BackLink onBack={onBack} />

        <div className="trip-detail-cover">
          {coverUrl ? (
            <ShimmerImage src={getUploadUrl(coverUrl)} className="trip-detail-cover-media" loading="eager" />
          ) : (
            <div className="trip-detail-cover-placeholder" aria-hidden>
              🧳
            </div>
          )}
        </div>

        <section className="trip-detail-header">
          <span className={`trip-badge ${trip.closed ? 'trip-badge-closed' : 'trip-badge-active'}`}>
            {trip.closed ? t('trip.detail.closedBadge') : t('trip.detail.activeBadge', { day: trip.dayNumber ?? 1 })}
          </span>
          <h1 className="trip-detail-title">{trip.title}</h1>
          {trip.destination && <div className="trip-detail-destination">→ {trip.destination}</div>}

          {!trip.closed ? (
            <div className="trip-detail-author-row">
              <Avatar name={post.author.name} avatarUrl={post.author.avatarUrl} size={30} />
              <span>{t('trip.detail.sinceLabel', { author: post.author.name, date: formatDayMonth(trip.startDate, i18n.language) })}</span>
            </div>
          ) : (
            <div className="trip-detail-stats">
              <div className="trip-detail-stat">
                <div className="trip-detail-stat-number">{trip.stopCount}</div>
                <div className="trip-detail-stat-label">{t('trip.detail.statsStops')}</div>
              </div>
              <div className="trip-detail-stat">
                <div className="trip-detail-stat-number">{trip.photoCount}</div>
                <div className="trip-detail-stat-label">{t('trip.detail.statsPhotos')}</div>
              </div>
              <div className="trip-detail-stat">
                <div className="trip-detail-stat-number">{trip.durationDays ?? 0}</div>
                <div className="trip-detail-stat-label">{t('trip.detail.statsDays')}</div>
              </div>
            </div>
          )}

          {travelers.length > 0 && (
            <div className="trip-detail-travelers" aria-label={t('trip.detail.travelersRowLabel')}>
              <div className="trip-detail-travelers-stack">
                {travelers.slice(0, 5).map((traveler) => (
                  <span key={traveler.id} className="trip-detail-traveler-face">
                    <Avatar name={traveler.name} avatarUrl={traveler.avatarUrl} size={26} />
                  </span>
                ))}
              </div>
              <span className="trip-detail-travelers-text">
                {t('trip.detail.travelersWith', { names: travelers.map((traveler) => traveler.name).join(', ') })}
              </span>
            </div>
          )}
        </section>

        <section className="trip-detail-comments-section">
          <h2 className="trip-detail-section-title">
            {t('trip.detail.tripCommentsSectionTitle', { count: tripComments.length })}
          </h2>
          <CommentsSection post={post} filterComments={(all) => all.filter((c) => c.metadata?.kind !== 'trip_checkin')} />
        </section>

        {sortedCheckins.length > 0 && (
          <div className="trip-detail-timeline-label">
            {trip.closed ? t('trip.detail.timelineLabelClosed') : t('trip.detail.timelineLabelActive')}
          </div>
        )}

        {sortedCheckins.length === 0 ? (
          <div className="trip-detail-empty">
            <div className="trip-detail-empty-icon" aria-hidden>
              🧳
            </div>
            <div className="trip-detail-empty-title">{t('trip.detail.emptyTitle')}</div>
            <div className="trip-detail-empty-description">
              {t('trip.detail.emptyDescription', { name: post.author.name })}
            </div>
          </div>
        ) : (
          <ol className="trip-detail-timeline">
            {sortedCheckins.map((entry, index) => (
              <CheckinTimelineItem
                key={entry.comment.id}
                entry={entry}
                tripAuthorId={post.authorId}
                closed={trip.closed}
                isLast={index === sortedCheckins.length - 1}
                onOpenPhotos={(urls, i) => setLightbox({ urls, index: i })}
              />
            ))}
          </ol>
        )}

        {trip.closed && (
          <div className="trip-detail-closing-line">
            {t('trip.detail.closingLine', {
              author: post.author.name,
              date: formatDayMonth(trip.closedAt || trip.endDate || trip.startDate, i18n.language),
            })}
          </div>
        )}
      </main>

      <BottomNav active="feed" onFeed={onBack} onPhotos={onOpenPhotos} onChat={onOpenChat} onProfile={onOpenProfile ?? (() => {})} />

      {lightbox && (
        <Lightbox assetUrls={lightbox.urls} initialIndex={lightbox.index} onClose={() => setLightbox(null)} />
      )}
    </div>
  );
}

function BackLink({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation();
  return (
    <button className="trip-detail-back" onClick={onBack}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path d="M15 5l-7 7 7 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {t('trip.detail.backToFeed')}
    </button>
  );
}

// A single check-in on the timeline: day/time label, place, text, photo
// grid (opens the shared Lightbox), and the same like + reply affordances
// CommentsSection gives ordinary comments — reply posts a normal threaded
// Comment (parentId = this check-in's id), it isn't part of "composing a
// check-in" (which stays out of scope for this page).
function CheckinTimelineItem({
  entry,
  tripAuthorId,
  closed,
  isLast,
  onOpenPhotos,
}: {
  entry: TripCheckinEntry;
  tripAuthorId: string;
  closed: boolean;
  isLast: boolean;
  onOpenPhotos: (urls: string[], index: number) => void;
}) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const [repliesOpen, setRepliesOpen] = useState(false);
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyDraft, setReplyDraft] = useState('');

  const { comment, dayNumber, replies } = entry;
  const metadata = comment.metadata;
  const photoUrls = metadata?.photoUrls ?? [];
  // A co-traveler's check-in gets attributed explicitly; the trip author's
  // own check-ins don't repeat their name on every entry (the header
  // already names them).
  const isCoTravelerCheckin = comment.authorId !== tripAuthorId;

  const likeMutation = useMutation({
    mutationFn: () => reactToComment(comment.id, 'LIKE'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['comments', comment.postId] }),
  });

  const replyMutation = useMutation({
    mutationFn: (content: string) => createComment(comment.postId, { content, parentId: comment.id }),
    onSuccess: () => {
      setReplyDraft('');
      setReplyOpen(false);
      setRepliesOpen(true);
      queryClient.invalidateQueries({ queryKey: ['comments', comment.postId] });
      patchPostInCaches(queryClient, comment.postId, (p) => ({ ...p, commentCount: p.commentCount + 1 }));
    },
  });

  function submitReply() {
    const trimmed = replyDraft.trim();
    if (trimmed && !replyMutation.isPending) replyMutation.mutate(trimmed);
  }

  return (
    <li className="trip-timeline-row">
      <div className="trip-timeline-connector" aria-hidden>
        <span className="trip-timeline-dot" />
        {!isLast && <span className="trip-timeline-line" />}
      </div>
      <div className="trip-timeline-content">
        <div className="trip-timeline-day-label">
          {closed
            ? t('trip.detail.dayDateLabel', { day: dayNumber, date: formatDayMonth(comment.createdAt, i18n.language) })
            : t('trip.detail.dayTimeLabel', { day: dayNumber, time: formatTime(comment.createdAt, i18n.language) })}
        </div>
        {metadata && <div className="trip-timeline-place">{metadata.place}</div>}

        {isCoTravelerCheckin && (
          <div className="trip-timeline-author-row">
            <Avatar name={comment.author.name} avatarUrl={comment.author.avatarUrl} size={20} />
            <span className="trip-timeline-author-name">{comment.author.name}</span>
          </div>
        )}

        {!!comment.content && <p className="trip-timeline-text">{comment.content}</p>}

        {photoUrls.length > 0 && (
          <div className={`trip-timeline-photos${photoUrls.length === 1 ? ' trip-timeline-photos-single' : ''}`}>
            {photoUrls.map((url, index) => (
              <button
                key={url}
                type="button"
                className="trip-timeline-photo-tile"
                onClick={() => onOpenPhotos(photoUrls, index)}
              >
                {isVideoUrl(url) ? (
                  <video src={getUploadUrl(url)} muted preload="metadata" />
                ) : (
                  <ShimmerImage src={getUploadUrl(url, 'thumbnail')} fallbackSrc={getUploadUrl(url)} loading="lazy" />
                )}
              </button>
            ))}
          </div>
        )}

        <div className="trip-timeline-footer">
          <button
            type="button"
            className={`comment-like${comment.likedByMe ? ' comment-like-active' : ''}`}
            onClick={() => likeMutation.mutate()}
            disabled={likeMutation.isPending}
          >
            {t('trip.detail.likesLabel', { count: comment.likeCount })}
          </button>
          <button type="button" className="comment-like" onClick={() => setReplyOpen((v) => !v)}>
            {t('trip.detail.replyAction')}
          </button>
          {replies.length > 0 && (
            <button type="button" className="comment-like" onClick={() => setRepliesOpen((v) => !v)}>
              {t('trip.detail.commentsCountButton', { count: replies.length })}
            </button>
          )}
        </div>

        {repliesOpen && replies.length > 0 && (
          <div className="trip-timeline-replies">
            {replies.map((reply: Comment) => (
              <div key={reply.id} className="trip-timeline-reply">
                <Avatar name={reply.author.name} avatarUrl={reply.author.avatarUrl} size={22} />
                <span>
                  <span className="trip-timeline-reply-author">{reply.author.name}</span> {reply.content}
                </span>
              </div>
            ))}
          </div>
        )}

        {replyOpen && (
          <form
            className="trip-timeline-reply-form"
            onSubmit={(e) => {
              e.preventDefault();
              submitReply();
            }}
          >
            <input
              className="comment-input"
              value={replyDraft}
              onChange={(e) => setReplyDraft(e.target.value)}
              placeholder={t('trip.detail.replyPlaceholder')}
              maxLength={2000}
              autoFocus
            />
            <button type="submit" className="btn btn-primary comment-send" disabled={!replyDraft.trim() || replyMutation.isPending}>
              {t('comments.send')}
            </button>
          </form>
        )}
      </div>
    </li>
  );
}
