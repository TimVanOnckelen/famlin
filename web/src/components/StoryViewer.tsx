import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  REACTION_TYPES,
  ReactionType,
  Story,
  fetchStoryReactions,
  fetchStoryReplies,
  fetchStoryViews,
  getUploadUrl,
  isStoryLive,
  markStoryViewed,
  reactToStory,
  replyToStory,
} from '@famlin/api-client';
import { Avatar } from '@/components/Avatar';
import { Icon } from '@/components/Icon';
import { REACTION_EMOJI } from '@/constants/reactions';
import { formatRelativeDate } from '@/utils/time';
import './Stories.css';

// How long one story stays on screen before advancing, like Instagram.
export const STORY_DURATION_MS = 5000;

// Full-screen story player. `sequences` is a list of story runs — one per
// author for the tray, a single run for the Highlights row — and the viewer
// plays each run's items in order, then moves on to the next run.
//
// Web is view + react + reply only: creating, pinning and deleting stories
// live in the mobile app. On your own story you additionally see who viewed
// it, who reacted and the private replies you got.
export function StoryViewer({
  sequences,
  startSequence = 0,
  startIndex = 0,
  onClose,
}: {
  sequences: Story[][];
  startSequence?: number;
  startIndex?: number;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const [position, setPosition] = useState({ seq: startSequence, idx: startIndex });
  // Local overrides for what the viewer changed (reaction/reply), so the UI
  // updates instantly without refetching the whole tray.
  const [overrides, setOverrides] = useState<Record<string, Partial<Story>>>({});
  const [elapsed, setElapsed] = useState(0);
  const [hovering, setHovering] = useState(false);
  const [typing, setTyping] = useState(false);
  const [insightsOpen, setInsightsOpen] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [replyError, setReplyError] = useState<string | null>(null);

  const base = sequences[position.seq]?.[position.idx];
  const story = base ? { ...base, ...overrides[base.id] } : undefined;
  const paused = hovering || typing || insightsOpen;

  const goNext = useCallback(() => {
    setElapsed(0);
    setInsightsOpen(false);
    const { seq, idx } = position;
    if (idx + 1 < (sequences[seq]?.length ?? 0)) setPosition({ seq, idx: idx + 1 });
    else if (seq + 1 < sequences.length) setPosition({ seq: seq + 1, idx: 0 });
    else onClose();
  }, [position, sequences, onClose]);

  const goPrev = useCallback(() => {
    setElapsed(0);
    setInsightsOpen(false);
    const { seq, idx } = position;
    if (idx > 0) setPosition({ seq, idx: idx - 1 });
    else if (seq > 0) setPosition({ seq: seq - 1, idx: (sequences[seq - 1]?.length ?? 1) - 1 });
  }, [position, sequences]);

  // Record the "seen by" receipt once per story shown. The server ignores it
  // for your own story and for an expired Highlight, so no need to check.
  const viewedRef = useRef(new Set<string>());
  useEffect(() => {
    if (!story || viewedRef.current.has(story.id)) return;
    viewedRef.current.add(story.id);
    markStoryViewed(story.id).catch(() => {});
  }, [story]);

  // Auto-advance, paused while hovering, typing a reply or reading insights.
  useEffect(() => {
    if (paused || !story) return;
    const tick = 100;
    const timer = window.setInterval(() => setElapsed((e) => e + tick), tick);
    return () => window.clearInterval(timer);
  }, [paused, story]);

  useEffect(() => {
    if (elapsed >= STORY_DURATION_MS) goNext();
  }, [elapsed, goNext]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (typing) return;
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft') goPrev();
      if (e.key === 'ArrowRight') goNext();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [goNext, goPrev, onClose, typing]);

  // The tray's seen state (and a new reaction/reply) is stale once closed.
  useEffect(() => {
    return () => {
      queryClient.invalidateQueries({ queryKey: ['stories'] });
    };
  }, [queryClient]);

  const react = useMutation({
    mutationFn: (type: ReactionType) => reactToStory(story!.id, type),
    onSuccess: ({ myReaction }) => {
      setOverrides((o) => ({ ...o, [story!.id]: { ...o[story!.id], myReaction } }));
    },
  });

  const reply = useMutation({
    mutationFn: (content: string) => replyToStory(story!.id, content),
    onSuccess: (sent) => {
      setOverrides((o) => ({ ...o, [story!.id]: { ...o[story!.id], myReply: sent } }));
      setReplyText('');
      setReplyError(null);
      setTyping(false);
    },
    onError: () => setReplyError(t('stories.replyFailed')),
  });

  if (!story) return null;

  const run = sequences[position.seq] ?? [];
  const live = isStoryLive(story);
  const progress = Math.min(1, elapsed / STORY_DURATION_MS);

  function submitReply(e: FormEvent) {
    e.preventDefault();
    const content = replyText.trim();
    if (content) reply.mutate(content);
  }

  return (
    <div className="story-viewer" role="dialog" aria-modal aria-label={t('stories.viewerLabel')} onClick={onClose}>
      <div
        className="story-stage"
        onClick={(e) => e.stopPropagation()}
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => setHovering(false)}
      >
        <div className="story-progress" aria-hidden>
          {run.map((item, i) => (
            <span key={item.id} className="story-progress-track">
              <span
                className="story-progress-fill"
                style={{ width: `${i < position.idx ? 100 : i === position.idx ? progress * 100 : 0}%` }}
              />
            </span>
          ))}
        </div>

        <header className="story-header">
          <Avatar name={story.author.name} avatarUrl={story.author.avatarUrl} size={36} />
          <div className="story-header-text">
            <span className="story-author">{story.author.name}</span>
            <span className="story-meta">
              {formatRelativeDate(story.createdAt, i18n.language)} · {story.circle?.name ?? story.group.name}
              {story.pinnedAt && ` · ${t('stories.highlightBadge')}`}
            </span>
          </div>
          <button className="story-icon-button" onClick={onClose} aria-label={t('common.close')}>
            <Icon name="x" size={22} color="white" strokeWidth={2.5} />
          </button>
        </header>

        <img className="story-image" src={getUploadUrl(story.imageUrl)} alt={t('stories.imageAlt', { name: story.author.name })} />

        <button className="story-tap story-tap-prev" onClick={goPrev} aria-label={t('stories.previous')} />
        <button className="story-tap story-tap-next" onClick={goNext} aria-label={t('stories.next')} />

        <footer className="story-footer">
          {story.isMine ? (
            <button className="story-insights-button" onClick={() => setInsightsOpen(true)}>
              {t('stories.seenBy', { count: story.stats?.viewCount ?? 0 })}
              {(story.stats?.reactionCount ?? 0) > 0 && ` · ${t('stories.reactionsCount', { count: story.stats!.reactionCount })}`}
              {(story.stats?.replyCount ?? 0) > 0 && ` · ${t('stories.repliesCount', { count: story.stats!.replyCount })}`}
            </button>
          ) : (
            <>
              <div className="story-reactions" role="group" aria-label={t('stories.reactLabel')}>
                {REACTION_TYPES.map((type) => (
                  <button
                    key={type}
                    className={`story-reaction${story.myReaction === type ? ' story-reaction-active' : ''}`}
                    onClick={() => react.mutate(type)}
                    aria-pressed={story.myReaction === type}
                    aria-label={t(`stories.reactions.${type}`)}
                    disabled={react.isPending}
                  >
                    {REACTION_EMOJI[type]}
                  </button>
                ))}
              </div>
              {story.myReply ? (
                <p className="story-replied">{t('stories.youReplied', { content: story.myReply.content })}</p>
              ) : live ? (
                <form className="story-reply-form" onSubmit={submitReply}>
                  <input
                    className="story-reply-input"
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    onFocus={() => setTyping(true)}
                    onBlur={() => setTyping(false)}
                    placeholder={t('stories.replyPlaceholder', { name: story.author.name })}
                    aria-label={t('stories.replyLabel')}
                    maxLength={500}
                  />
                  <button
                    type="submit"
                    className="story-icon-button"
                    disabled={!replyText.trim() || reply.isPending}
                    aria-label={t('stories.sendReply')}
                  >
                    <Icon name="send" size={20} color="white" strokeWidth={2} />
                  </button>
                </form>
              ) : null}
              {replyError && (
                <p className="story-error" role="alert">
                  {replyError}
                </p>
              )}
            </>
          )}
        </footer>

        {insightsOpen && story.isMine && <StoryInsights storyId={story.id} onClose={() => setInsightsOpen(false)} />}
      </div>
    </div>
  );
}

// Author-only panel: who viewed, who reacted with what, and the private
// replies — all three lists are 404 for anyone else server-side.
function StoryInsights({ storyId, onClose }: { storyId: string; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const [tab, setTab] = useState<'views' | 'reactions' | 'replies'>('views');

  const views = useQuery({ queryKey: ['story-views', storyId], queryFn: () => fetchStoryViews(storyId) });
  const reactions = useQuery({ queryKey: ['story-reactions', storyId], queryFn: () => fetchStoryReactions(storyId) });
  const replies = useQuery({ queryKey: ['story-replies', storyId], queryFn: () => fetchStoryReplies(storyId) });

  return (
    <div className="story-insights" role="dialog" aria-label={t('stories.insightsLabel')}>
      <div className="story-insights-tabs" role="tablist">
        {(['views', 'reactions', 'replies'] as const).map((key) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            className={`story-insights-tab${tab === key ? ' story-insights-tab-active' : ''}`}
            onClick={() => setTab(key)}
          >
            {t(`stories.tabs.${key}`)}
          </button>
        ))}
        <button className="story-insights-close" onClick={onClose} aria-label={t('common.close')}>
          <Icon name="x" size={18} strokeWidth={2.5} />
        </button>
      </div>

      <ul className="story-insights-list">
        {tab === 'views' &&
          (views.data ?? []).map((v) => (
            <li key={v.id} className="story-insights-row">
              <Avatar name={v.name} avatarUrl={v.avatarUrl} size={32} />
              <span className="story-insights-name">{v.name}</span>
              <span className="story-insights-meta">{formatRelativeDate(v.viewedAt, i18n.language)}</span>
            </li>
          ))}
        {tab === 'reactions' &&
          (reactions.data ?? []).map((r) => (
            <li key={r.id} className="story-insights-row">
              <Avatar name={r.name} avatarUrl={r.avatarUrl} size={32} />
              <span className="story-insights-name">{r.name}</span>
              <span className="story-insights-meta" aria-label={t(`stories.reactions.${r.type}`)}>
                {REACTION_EMOJI[r.type]}
              </span>
            </li>
          ))}
        {tab === 'replies' &&
          (replies.data ?? []).map((r) => (
            <li key={r.id} className="story-insights-row story-insights-reply">
              <Avatar name={r.fromUser.name} avatarUrl={r.fromUser.avatarUrl} size={32} />
              <span>
                <span className="story-insights-name">{r.fromUser.name}</span>
                <span className="story-insights-reply-text">{r.content}</span>
              </span>
            </li>
          ))}
      </ul>
      {tab === 'replies' && replies.isSuccess && replies.data.length === 0 && (
        <p className="story-insights-empty">{t('stories.noReplies')}</p>
      )}
      {tab === 'views' && views.isSuccess && views.data.length === 0 && (
        <p className="story-insights-empty">{t('stories.noViews')}</p>
      )}
      {tab === 'reactions' && reactions.isSuccess && reactions.data.length === 0 && (
        <p className="story-insights-empty">{t('stories.noReactions')}</p>
      )}
      <p className="story-insights-privacy">{t('stories.repliesPrivate')}</p>
    </div>
  );
}
