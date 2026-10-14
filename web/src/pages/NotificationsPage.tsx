import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import {
  fetchNotifications,
  fetchStory,
  markAllNotificationsRead,
  markNotificationRead,
  type Notification,
  type User,
} from '@famlin/api-client'
import { AppShell } from '@/components/AppShell'
import { ScreenHeader } from '@/components/ScreenHeader'
import { StoryViewer } from '@/components/StoryViewer'
import './NotificationsPage.css'

export function NotificationsPage({
  user,
  onOpenFeed,
  onOpenPhotos,
  onOpenChat,
  onOpenFavorites,
  onOpenSearch,
  onOpenProfile,
  onOpenPost,
  onLogout,
}: {
  user: User
  onOpenFeed: () => void
  onOpenPhotos: () => void
  onOpenChat: () => void
  onOpenFavorites: () => void
  onOpenSearch?: (groupId?: string) => void
  onOpenProfile: () => void
  onOpenPost: (id: string) => void
  onLogout: () => void
}) {
  const { t, i18n } = useTranslation()
  const client = useQueryClient()
  const [storyId, setStoryId] = useState<string | null>(null)
  const notifications = useQuery({
    queryKey: ['notifications'],
    queryFn: fetchNotifications,
    refetchInterval: 30000,
  })
  const story = useQuery({
    queryKey: ['story', storyId],
    queryFn: () => fetchStory(storyId!),
    enabled: !!storyId,
  })
  const markRead = useMutation({ mutationFn: markNotificationRead, onSuccess: invalidate })
  const markAll = useMutation({ mutationFn: markAllNotificationsRead, onSuccess: invalidate })

  function invalidate() {
    void client.invalidateQueries({ queryKey: ['notifications'] })
    void client.invalidateQueries({ queryKey: ['unread-count'] })
  }

  function open(item: Notification) {
    if (!item.readAt) markRead.mutate(item.id)
    if (item.relatedPostId) onOpenPost(item.relatedPostId)
    else if (item.relatedStoryId) setStoryId(item.relatedStoryId)
  }

  return (
    <AppShell
      user={user}
      active="notifications"
      onFeed={onOpenFeed}
      onPhotos={onOpenPhotos}
      onChat={onOpenChat}
      onFavorites={onOpenFavorites}
      onSearch={onOpenSearch}
      onNotifications={() => {}}
      onProfile={onOpenProfile}
      onLogout={onLogout}
    >
      <div className="notifications-column">
        <div className="notifications-header">
          <ScreenHeader title={t('notifications.title')} />
          <button
            className="btn btn-secondary"
            disabled={markAll.isPending || !notifications.data?.some((item) => !item.readAt)}
            onClick={() => markAll.mutate()}
          >
            {t('notifications.markAllRead')}
          </button>
        </div>
        {notifications.isLoading && <p role="status">{t('common.loading')}</p>}
        {notifications.isError && (
          <p role="alert">
            {t('notifications.loadFailed')}{' '}
            <button className="notifications-retry" onClick={() => notifications.refetch()}>
              {t('common.retry')}
            </button>
          </p>
        )}
        {(markRead.isError || markAll.isError) && <p role="alert">{t('notifications.markFailed')}</p>}
        {notifications.isSuccess && notifications.data.length === 0 && (
          <p className="notifications-empty">{t('notifications.empty')}</p>
        )}
        <ul className="notifications-list">
          {notifications.data?.map((item) => (
            <li key={item.id}>
              <button
                className={`notification-item${!item.readAt ? ' notification-unread' : ''}`}
                onClick={() => open(item)}
              >
                <span className="notification-dot">
                  {!item.readAt && <span aria-label={t('notifications.unread')} />}
                </span>
                <span className="notification-content">
                  <span>{item.message}</span>
                  <time dateTime={item.createdAt}>
                    {new Date(item.createdAt).toLocaleString(i18n.language, {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })}
                  </time>
                </span>
              </button>
            </li>
          ))}
        </ul>
        {storyId && story.isLoading && <p role="status">{t('common.loading')}</p>}
        {storyId && story.isError && (
          <p role="alert">
            {t('notifications.storyUnavailable')}{' '}
            <button className="notifications-retry" onClick={() => setStoryId(null)}>
              {t('common.close')}
            </button>
          </p>
        )}
      </div>
      {storyId && story.data && (
        <StoryViewer key={storyId} sequences={[[story.data]]} onClose={() => setStoryId(null)} />
      )}
    </AppShell>
  )
}
