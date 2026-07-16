import { ChangeEvent, FormEvent, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  api,
  Post,
  Comment,
  fetchComments,
  createComment,
  reactToComment,
  getUploadUrl,
  patchPostInCaches,
} from '@famlin/api-client';
import { Avatar } from '@/components/Avatar';
import { Lightbox } from '@/components/Lightbox';
import { ShimmerImage } from '@/components/ShimmerImage';
import { formatRelativeDate } from '@/utils/time';
import { isVideoUrl } from '@/utils/media';

async function uploadCommentAttachment(file: File): Promise<string> {
  const formData = new FormData();
  formData.append('file', file);
  const response = await api.post<{ urls: string[] }>('/uploads', formData);
  return response.data.urls[0];
}

function CommentItem({ comment, isReply }: { comment: Comment; isReply: boolean }) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const [lightboxOpen, setLightboxOpen] = useState(false);

  // Basic like toggle (LIKE reaction) — the full per-emoji picker stays a
  // post-level affordance for now, matching the calm comment row in mobile.
  // The endpoint returns only { myReaction, counts }, so patch optimistically
  // and re-fetch rather than merging the response into the cache.
  const likeMutation = useMutation({
    mutationFn: () => reactToComment(comment.id, 'LIKE'),
    onMutate: () => {
      const liked = comment.myReaction === 'LIKE';
      queryClient.setQueryData<Comment[]>(['comments', comment.postId], (old) =>
        old?.map((c) =>
          c.id === comment.id
            ? {
                ...c,
                myReaction: liked ? null : 'LIKE',
                likedByMe: !liked,
                likeCount: Math.max(0, c.likeCount + (liked ? -1 : 1)),
              }
            : c
        )
      );
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['comments', comment.postId] });
    },
  });

  return (
    <div className={`comment${isReply ? ' comment-reply' : ''}`}>
      <Avatar name={comment.author.name} avatarUrl={comment.author.avatarUrl} size={32} />
      <div className="comment-main">
        <div className="comment-bubble">
          <span className="comment-author">{comment.author.name}</span>
          {!!comment.content && <span className="comment-text">{comment.content}</span>}
        </div>
        {comment.attachmentUrl && (
          <button
            type="button"
            className="comment-attachment"
            onClick={() => setLightboxOpen(true)}
            aria-label={t('comments.viewAttachment')}
          >
            {isVideoUrl(comment.attachmentUrl) ? (
              <video src={getUploadUrl(comment.attachmentUrl)} muted preload="metadata" />
            ) : (
              <ShimmerImage
                src={getUploadUrl(comment.attachmentUrl, 'thumbnail')}
                fallbackSrc={getUploadUrl(comment.attachmentUrl)}
                loading="lazy"
              />
            )}
          </button>
        )}
        <div className="comment-meta">
          <span>{formatRelativeDate(comment.createdAt, i18n.language)}</span>
          <button
            className={`comment-like${comment.likedByMe ? ' comment-like-active' : ''}`}
            onClick={() => likeMutation.mutate()}
            disabled={likeMutation.isPending}
          >
            {t('comments.like')}
            {comment.likeCount > 0 ? ` · ${comment.likeCount}` : ''}
          </button>
        </div>
      </div>

      {lightboxOpen && comment.attachmentUrl && (
        <Lightbox assetUrls={[comment.attachmentUrl]} initialIndex={0} onClose={() => setLightboxOpen(false)} />
      )}
    </div>
  );
}

export function CommentsSection({ post }: { post: Post }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState('');
  const [attachmentFile, setAttachmentFile] = useState<File | null>(null);
  const [attachmentPreviewUrl, setAttachmentPreviewUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const commentsQuery = useQuery({
    queryKey: ['comments', post.id],
    queryFn: () => fetchComments(post.id),
  });

  const createMutation = useMutation({
    mutationFn: async ({ content, file }: { content: string; file: File | null }) => {
      const attachmentUrl = file ? await uploadCommentAttachment(file) : undefined;
      return createComment(post.id, { content: content || undefined, attachmentUrl });
    },
    onSuccess: (created) => {
      setDraft('');
      clearAttachment();
      queryClient.setQueryData<Comment[]>(['comments', post.id], (old) =>
        old ? [...old, created] : [created]
      );
      patchPostInCaches(queryClient, post.id, (p) => ({ ...p, commentCount: p.commentCount + 1 }));
    },
  });

  function clearAttachment() {
    if (attachmentPreviewUrl) URL.revokeObjectURL(attachmentPreviewUrl);
    setAttachmentFile(null);
    setAttachmentPreviewUrl(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function pickAttachment(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (attachmentPreviewUrl) URL.revokeObjectURL(attachmentPreviewUrl);
    setAttachmentFile(file);
    setAttachmentPreviewUrl(URL.createObjectURL(file));
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    const content = draft.trim();
    if ((content || attachmentFile) && !createMutation.isPending) {
      createMutation.mutate({ content, file: attachmentFile });
    }
  }

  // Order: top-level comments chronologically, each followed by its replies.
  const comments = commentsQuery.data ?? [];
  const topLevel = comments.filter((c) => !c.parentId);
  const repliesFor = (parentId: string) => comments.filter((c) => c.parentId === parentId);

  return (
    <div className="comments-section">
      {commentsQuery.isLoading && <div className="comments-hint">{t('common.loading')}</div>}
      {commentsQuery.isError && <div className="comments-hint">{t('comments.loadFailed')}</div>}
      {commentsQuery.isSuccess && comments.length === 0 && (
        <div className="comments-hint">{t('comments.empty')}</div>
      )}

      {topLevel.map((comment) => (
        <div key={comment.id}>
          <CommentItem comment={comment} isReply={false} />
          {repliesFor(comment.id).map((reply) => (
            <CommentItem key={reply.id} comment={reply} isReply />
          ))}
        </div>
      ))}

      <form className="comment-composer-form" onSubmit={submit}>
        {attachmentPreviewUrl && (
          <div className="comment-attachment-preview">
            {attachmentFile?.type.startsWith('video/') ? (
              <video src={attachmentPreviewUrl} muted />
            ) : (
              <img src={attachmentPreviewUrl} alt="" />
            )}
            <button
              type="button"
              className="comment-attachment-remove"
              onClick={clearAttachment}
              aria-label={t('comments.removeAttachment')}
            >
              ×
            </button>
          </div>
        )}
        <div className="comment-composer">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,video/mp4,video/quicktime,video/webm"
            hidden
            onChange={pickAttachment}
          />
          <button
            type="button"
            className="comment-attach-button"
            onClick={() => fileInputRef.current?.click()}
            aria-label={t('comments.addAttachment')}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
              <rect x="3" y="3" width="18" height="18" rx="3" stroke="currentColor" strokeWidth="2" />
              <circle cx="9" cy="9" r="2" stroke="currentColor" strokeWidth="2" />
              <path d="M21 15l-5-5L5 21" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
            </svg>
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
            disabled={(!draft.trim() && !attachmentFile) || createMutation.isPending}
          >
            {t('comments.send')}
          </button>
        </div>
      </form>
      {createMutation.isError && <div className="comments-hint">{t('comments.sendFailed')}</div>}
    </div>
  );
}
