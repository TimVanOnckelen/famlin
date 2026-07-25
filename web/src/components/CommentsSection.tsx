import { ChangeEvent, FormEvent, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  uploadFiles,
  Post,
  Comment,
  CommentGroup,
  MAX_COMMENT_ATTACHMENTS,
  fetchComments,
  createComment,
  reactToComment,
  groupCommentAttachments,
  getUploadUrl,
  patchPostInCaches,
} from '@famlin/api-client';
import { Avatar } from '@/components/Avatar';
import { Icon } from '@/components/Icon';
import { Lightbox } from '@/components/Lightbox';
import { ShimmerImage } from '@/components/ShimmerImage';
import { formatRelativeDate } from '@/utils/time';
import { isVideoUrl } from '@/utils/media';

// Up to this many photos on one comment card lay out as a wrapping grid;
// beyond it the card becomes a horizontally scrolling gallery instead, so a
// long photo burst never pushes the rest of the thread down the page.
const GRID_MAX_TILES = 4;

function CommentGroupItem({ group, isReply }: { group: CommentGroup; isReply: boolean }) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const { lead, attachments } = group;

  // Basic reaction toggle — the full per-emoji picker stays a post-level
  // affordance for now, matching the calm comment row in mobile. Sending back
  // the reaction the user already left is what removes it, so a LOVE left
  // from mobile toggles off here instead of switching to LIKE.
  // The endpoint returns only { myReaction, counts }, so patch optimistically
  // and re-fetch rather than merging the response into the cache.
  const likeMutation = useMutation({
    mutationFn: () => reactToComment(group.reactionTargetId, group.myReaction ?? 'LIKE'),
    onMutate: () => {
      const reacted = !!group.myReaction;
      queryClient.setQueryData<Comment[]>(['comments', lead.postId], (old) =>
        old?.map((c) =>
          c.id === group.reactionTargetId
            ? {
                ...c,
                myReaction: reacted ? null : 'LIKE',
                likedByMe: !reacted,
                likeCount: Math.max(0, c.likeCount + (reacted ? -1 : 1)),
              }
            : c
        )
      );
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['comments', lead.postId] });
    },
  });

  const isGallery = attachments.length > GRID_MAX_TILES;
  const layout = isGallery
    ? 'comment-attachment-gallery'
    : attachments.length > 1
      ? 'comment-attachment-grid'
      : 'comment-attachment';

  const tiles = attachments.map(({ url, commentId }, index) => (
    <button
      key={`${commentId}-${url}`}
      type="button"
      className="comment-attachment-tile"
      onClick={() => setLightboxIndex(index)}
      aria-label={t('comments.viewAttachment')}
    >
      {isVideoUrl(url) ? (
        <video src={getUploadUrl(url)} muted preload="metadata" />
      ) : (
        <ShimmerImage src={getUploadUrl(url, 'thumbnail')} fallbackSrc={getUploadUrl(url)} loading="lazy" />
      )}
    </button>
  ));

  return (
    <div className={`comment${isReply ? ' comment-reply' : ''}`}>
      <Avatar name={lead.author.name} avatarUrl={lead.author.avatarUrl} size={32} />
      <div className="comment-main">
        <div className="comment-bubble">
          <span className="comment-author">{lead.author.name}</span>
          {!!lead.content && <span className="comment-text">{lead.content}</span>}
        </div>
        {attachments.length > 0 &&
          // A scrolling row needs to say so: the count badge and the fade at
          // the right edge are what tell you there's more than fits.
          (isGallery ? (
            <div className="comment-attachment-gallery-wrap">
              <div className={layout}>{tiles}</div>
              <span className="comment-attachment-count">
                <Icon name="image" size={12} />
                {attachments.length}
              </span>
            </div>
          ) : (
            <div className={layout}>{tiles}</div>
          ))}
        <div className="comment-meta">
          <span>{formatRelativeDate(lead.createdAt, i18n.language)}</span>
          {attachments.length > 1 && <span>{t('comments.photoCount', { count: attachments.length })}</span>}
          <button
            className={`comment-like${group.myReaction ? ' comment-like-active' : ''}`}
            onClick={() => likeMutation.mutate()}
            disabled={likeMutation.isPending}
          >
            {t('comments.like')}
            {group.likeCount > 0 ? ` · ${group.likeCount}` : ''}
          </button>
        </div>
      </div>

      {lightboxIndex !== null && (
        <Lightbox
          assetUrls={attachments.map((a) => a.url)}
          initialIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
        />
      )}
    </div>
  );
}

export function CommentsSection({
  post,
  filterComments,
}: {
  post: Post;
  // Applied to the fetched list before splitting it into top-level/replies —
  // used by TripDetailPage's "Reacties op de reis" section to hide check-in
  // comments (metadata.kind === 'trip_checkin') from that section: their
  // replies stay in the same query-cache array but, once the check-in itself
  // is filtered out of `comments`, never get looked up by repliesFor below
  // (it's only called for what's left in topLevel), so they're excluded too
  // without any extra filtering. Omitted = show everything, unchanged from
  // before this prop existed.
  filterComments?: (comments: Comment[]) => Comment[];
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState<{ file: File; previewUrl: string }[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const commentsQuery = useQuery({
    queryKey: ['comments', post.id],
    queryFn: () => fetchComments(post.id),
  });

  const createMutation = useMutation({
    mutationFn: async ({ content, files }: { content: string; files: File[] }) => {
      const attachmentUrls = files.length ? await uploadFiles(files) : undefined;
      return createComment(post.id, { content: content || undefined, attachmentUrls });
    },
    onSuccess: (created) => {
      setDraft('');
      clearAttachments();
      queryClient.setQueryData<Comment[]>(['comments', post.id], (old) =>
        old ? [...old, created] : [created]
      );
      patchPostInCaches(queryClient, post.id, (p) => ({ ...p, commentCount: p.commentCount + 1 }));
    },
  });

  function clearAttachments() {
    pending.forEach((item) => URL.revokeObjectURL(item.previewUrl));
    setPending([]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function removeAttachment(index: number) {
    setPending((old) => {
      const removed = old[index];
      if (removed) URL.revokeObjectURL(removed.previewUrl);
      return old.filter((_, i) => i !== index);
    });
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function pickAttachments(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    setPending((old) => {
      // Picking again adds to what's already staged; anything past the
      // server's per-comment cap is dropped rather than failing the send.
      const room = MAX_COMMENT_ATTACHMENTS - old.length;
      const added = files.slice(0, Math.max(0, room)).map((file) => ({
        file,
        previewUrl: URL.createObjectURL(file),
      }));
      return [...old, ...added];
    });
    // Let the same file be picked again after it's removed.
    e.target.value = '';
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    const content = draft.trim();
    if ((content || pending.length) && !createMutation.isPending) {
      createMutation.mutate({ content, files: pending.map((item) => item.file) });
    }
  }

  // Order: top-level comment groups chronologically, each followed by its
  // replies. Grouping collapses runs of photo-only comments by the same author
  // into one card (see groupCommentAttachments) — replies are grouped the same
  // way within their own thread.
  const rawComments = commentsQuery.data ?? [];
  const comments = filterComments ? filterComments(rawComments) : rawComments;
  const topLevelGroups = groupCommentAttachments(comments.filter((c) => !c.parentId));
  const replyGroupsFor = (group: CommentGroup) =>
    groupCommentAttachments(
      comments.filter((c) => group.comments.some((parent) => parent.id === c.parentId))
    );

  return (
    <div className="comments-section">
      {commentsQuery.isLoading && <div className="comments-hint">{t('common.loading')}</div>}
      {commentsQuery.isError && <div className="comments-hint">{t('comments.loadFailed')}</div>}
      {commentsQuery.isSuccess && comments.length === 0 && (
        <div className="comments-hint">{t('comments.empty')}</div>
      )}

      {topLevelGroups.map((group) => (
        <div key={group.key}>
          <CommentGroupItem group={group} isReply={false} />
          {replyGroupsFor(group).map((reply) => (
            <CommentGroupItem key={reply.key} group={reply} isReply />
          ))}
        </div>
      ))}

      <form className="comment-composer-form" onSubmit={submit}>
        {pending.length > 0 && (
          <div className="comment-attachment-previews">
            {pending.map((item, index) => (
              <div className="comment-attachment-preview" key={item.previewUrl}>
                {item.file.type.startsWith('video/') ? (
                  <video src={item.previewUrl} muted />
                ) : (
                  <img src={item.previewUrl} alt="" />
                )}
                <button
                  type="button"
                  className="comment-attachment-remove"
                  onClick={() => removeAttachment(index)}
                  aria-label={t('comments.removeAttachment')}
                >
                  <Icon name="x" size={12} strokeWidth={2.5} />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="comment-composer">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,video/mp4,video/quicktime,video/webm"
            multiple
            hidden
            onChange={pickAttachments}
          />
          <button
            type="button"
            className="comment-attach-button"
            onClick={() => fileInputRef.current?.click()}
            disabled={pending.length >= MAX_COMMENT_ATTACHMENTS}
            aria-label={t('comments.addAttachment')}
          >
            <Icon name="image" size={18} />
          </button>
          <input
            className="comment-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={t('comments.placeholder')}
            maxLength={2000}
          />
          <button
            type="submit"
            className="btn btn-primary comment-send"
            disabled={(!draft.trim() && !pending.length) || createMutation.isPending}
          >
            {t('comments.send')}
          </button>
        </div>
      </form>
      {createMutation.isError && <div className="comments-hint">{t('comments.sendFailed')}</div>}
    </div>
  );
}
