import { FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Post,
  Comment,
  fetchComments,
  createComment,
  reactToComment,
  patchPostInCaches,
} from '@famlin/api-client';
import { Avatar } from '@/components/Avatar';
import { formatRelativeDate } from '@/utils/time';

function CommentItem({ comment, isReply }: { comment: Comment; isReply: boolean }) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();

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
          <span className="comment-text">{comment.content}</span>
        </div>
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
    </div>
  );
}

export function CommentsSection({ post }: { post: Post }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState('');

  const commentsQuery = useQuery({
    queryKey: ['comments', post.id],
    queryFn: () => fetchComments(post.id),
  });

  const createMutation = useMutation({
    mutationFn: (content: string) => createComment(post.id, { content }),
    onSuccess: (created) => {
      setDraft('');
      queryClient.setQueryData<Comment[]>(['comments', post.id], (old) =>
        old ? [...old, created] : [created]
      );
      patchPostInCaches(queryClient, post.id, (p) => ({ ...p, commentCount: p.commentCount + 1 }));
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    const content = draft.trim();
    if (content && !createMutation.isPending) {
      createMutation.mutate(content);
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

      <form className="comment-composer" onSubmit={submit}>
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
          disabled={!draft.trim() || createMutation.isPending}
        >
          {t('comments.send')}
        </button>
      </form>
      {createMutation.isError && <div className="comments-hint">{t('comments.sendFailed')}</div>}
    </div>
  );
}
