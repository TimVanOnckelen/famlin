import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Story, fetchStoryHighlights, fetchStoryTray, getUploadUrl } from '@famlin/api-client';
import { Avatar } from '@/components/Avatar';
import { StoryViewer } from '@/components/StoryViewer';
import './Stories.css';

type Viewing = { sequences: Story[][]; startSequence: number; startIndex: number } | null;

// The feed's story strip: the live tray (one avatar per author, a coloured
// ring while they have something you haven't seen) followed by the group's
// Highlights — pinned stories as one flat strip, newest first. Both follow
// the feed's family filter. Renders nothing when there's nothing to show,
// since web can't create stories and an empty strip would be a dead end.
export function StoryTray({ groupIds, enabled }: { groupIds: string[]; enabled: boolean }) {
  const { t } = useTranslation();
  const [viewing, setViewing] = useState<Viewing>(null);
  const groupKey = [...groupIds].sort().join(',') || 'all';

  const trayQuery = useQuery({
    queryKey: ['stories', 'tray', groupKey],
    queryFn: () => fetchStoryTray(groupIds),
    enabled,
    refetchInterval: 60_000,
  });
  const highlightsQuery = useInfiniteQuery({
    queryKey: ['stories', 'highlights', groupKey],
    queryFn: ({ pageParam }) => fetchStoryHighlights(groupIds, pageParam ?? undefined),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled,
  });

  const authors = trayQuery.data?.authors ?? [];
  const highlights = highlightsQuery.data?.pages.flatMap((p) => p.items) ?? [];

  if (!enabled || (authors.length === 0 && highlights.length === 0)) return null;

  function openAuthor(authorIndex: number) {
    const sequences = authors.map((a) => a.stories);
    // Resume at the author's first story you haven't seen yet.
    const firstUnseen = sequences[authorIndex].findIndex((s) => !s.seen);
    setViewing({ sequences, startSequence: authorIndex, startIndex: Math.max(0, firstUnseen) });
  }

  return (
    <>
      <div className="story-strip">
        {authors.length > 0 && (
          <div className="story-row" role="list" aria-label={t('stories.trayLabel')}>
            {authors.map((entry, i) => (
              <button
                key={entry.author.id}
                role="listitem"
                className={`story-bubble${entry.hasUnseen ? ' story-bubble-unseen' : ''}`}
                onClick={() => openAuthor(i)}
                aria-label={t(entry.hasUnseen ? 'stories.openUnseen' : 'stories.open', { name: entry.author.name })}
              >
                <span className="story-ring">
                  <Avatar name={entry.author.name} avatarUrl={entry.author.avatarUrl} size={56} />
                </span>
                <span className="story-bubble-name">
                  {entry.stories[0]?.isMine ? t('stories.yourStory') : entry.author.name.split(' ')[0]}
                </span>
              </button>
            ))}
          </div>
        )}

        {highlights.length > 0 && (
          <div className="story-highlights">
            <span className="story-highlights-title">{t('stories.highlights')}</span>
            <div className="story-row" role="list" aria-label={t('stories.highlights')}>
              {highlights.map((story, i) => (
                <button
                  key={story.id}
                  role="listitem"
                  className="story-highlight"
                  onClick={() => setViewing({ sequences: [highlights], startSequence: 0, startIndex: i })}
                  aria-label={t('stories.openHighlight', { name: story.author.name })}
                >
                  <img src={getUploadUrl(story.imageUrl, 'thumbnail')} alt="" loading="lazy" />
                </button>
              ))}
              {highlightsQuery.hasNextPage && (
                <button
                  className="story-highlight story-highlight-more"
                  onClick={() => highlightsQuery.fetchNextPage()}
                  disabled={highlightsQuery.isFetchingNextPage}
                >
                  {t('stories.moreHighlights')}
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {viewing && (
        <StoryViewer
          sequences={viewing.sequences}
          startSequence={viewing.startSequence}
          startIndex={viewing.startIndex}
          onClose={() => setViewing(null)}
        />
      )}
    </>
  );
}
