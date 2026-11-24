import { useEffect, useRef, useState } from 'react'
import { InfiniteData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router'
import {
  ChatConversation,
  ChatConversationMessage,
  ChatConversationMessagesPage,
  ChatEligiblePerson,
  createChatConversation,
  deleteChatMessage,
  fetchChatConversations,
  fetchChatConversationMessages,
  fetchChatPeople,
  getUploadUrl,
  isChatEncryptionSupported,
  markChatConversationRead,
  sendChatConversationMessage,
  sendChatMessage,
  User,
} from '@famlin/api-client'
import { AppShell } from '@/components/AppShell'
import { Avatar } from '@/components/Avatar'
import { ScreenHeader } from '@/components/ScreenHeader'
import { Icon } from '@/components/Icon'
import { useModalFocus } from '@/hooks/useModalFocus'
import { useComposerUploads } from '@/hooks/useComposerUploads'
import { ComposerUploadPreview } from '@/components/ComposerUploadPreview'
import { ShimmerImage } from '@/components/ShimmerImage'
import { Lightbox } from '@/components/Lightbox'
import { isVideoUrl } from '@/utils/media'
import './ChatPage.css'

type ChatPageProps = {
  user: User
  onBack: () => void
  onOpenPhotos?: () => void
  onOpenProfile?: () => void
  onOpenFavorites?: () => void
  onOpenWiki?: () => void
  onOpenNotifications?: () => void
  onOpenSearch?: (groupId?: string) => void
  onOpenMembers?: () => void
  onLogout: () => void
}

export function DirectMessagesChatPage(props: ChatPageProps) {
  const { t, i18n } = useTranslation()
  const client = useQueryClient()
  const location = useLocation()
  const navigate = useNavigate()
  const [pickerOpen, setPickerOpen] = useState(false)
  const conversations = useQuery({
    queryKey: ['chat-conversations'],
    queryFn: fetchChatConversations,
  })
  const items = conversations.data?.items ?? []
  const sortedItems = [...items].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
  const family = sortedItems.filter((item) => item.kind === 'FAMILY')
  const direct = sortedItems.filter((item) => item.kind === 'PRIVATE')
  const params = new URLSearchParams(location.search)
  const requestedConversationId = params.get('conversation')
  const requestedGroupId = params.get('group')
  const hasExplicitSelection = requestedConversationId !== null || requestedGroupId !== null
  const showInboxOnly = (location.state as { showInboxOnly?: boolean } | null)?.showInboxOnly === true
  const selected = conversations.isSuccess
    ? hasExplicitSelection
      ? (items.find((item) =>
          requestedConversationId
            ? item.id === requestedConversationId
            : item.kind === 'FAMILY' && item.group?.id === requestedGroupId
        ) ?? null)
      : showInboxOnly
        ? null
        : (family[0] ?? direct[0] ?? null)
    : null
  const selectedId = selected?.id ?? null
  const explicitSelectionUnavailable = conversations.isSuccess && hasExplicitSelection && !selected

  const messagesQuery = useInfiniteQuery({
    queryKey: ['chat-messages', selectedId],
    queryFn: ({ pageParam }) => fetchChatConversationMessages(selectedId!, { cursor: pageParam ?? undefined }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: selected !== null,
    refetchInterval: () => (document.visibilityState === 'hidden' ? false : 6000),
  })
  const messages = [...(messagesQuery.data?.pages.flatMap((page) => page.items) ?? [])].reverse()
  const newestMessageId = messagesQuery.data?.pages[0]?.items[0]?.id

  const markRead = useMutation({
    mutationFn: (conversationId: string) => markChatConversationRead(conversationId),
    onSuccess: (_, conversationId) => {
      client.setQueryData<{ items: ChatConversation[] }>(['chat-conversations'], (old) =>
        old
          ? {
              ...old,
              items: old.items.map((item) =>
                item.id === conversationId && item.unreadCount ? { ...item, unreadCount: 0 } : item
              ),
            }
          : old
      )
      void client.invalidateQueries({ queryKey: ['chat-unread-conversations'] })
    },
  })

  useEffect(() => {
    if (selectedId && messagesQuery.isSuccess) markRead.mutate(selectedId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, newestMessageId, messagesQuery.isSuccess])

  function selectConversation(conversation: ChatConversation) {
    const search = new URLSearchParams()
    search.set('conversation', conversation.id)
    const chatFromInbox = (location.state as { chatFromInbox?: boolean } | null)?.chatFromInbox ?? !selectedId
    navigate(
      { pathname: '/chat', search: search.toString() },
      { replace: !!selectedId, state: { chatFromInbox, showInboxOnly: false } }
    )
  }

  function openInbox() {
    if ((location.state as { chatFromInbox?: boolean } | null)?.chatFromInbox) navigate(-1)
    else navigate('/chat', { replace: true, state: { showInboxOnly: true } })
  }

  return (
    <AppShell
      user={props.user}
      active="chat"
      onFeed={props.onBack}
      onPhotos={props.onOpenPhotos}
      onFavorites={props.onOpenFavorites}
      onWiki={props.onOpenWiki}
      onNotifications={props.onOpenNotifications}
      onMembers={props.onOpenMembers}
      onSearch={props.onOpenSearch}
      onProfile={props.onOpenProfile ?? (() => {})}
      onLogout={props.onLogout}
    >
      <div className="chat-column">
        <div className="chat-page-heading">
          <ScreenHeader title={t('chat.title')} />
          <button
            type="button"
            className="btn btn-primary chat-new-message"
            aria-label={t('chat.newMessage')}
            onClick={() => setPickerOpen(true)}
          >
            <Icon name="plus" size={18} strokeWidth={2.5} className="chat-new-message-icon" />
            <span className="chat-new-message-label">{t('chat.newMessage')}</span>
          </button>
        </div>
        {conversations.isError && (
          <div className="chat-hint">
            {t('chat.inboxLoadFailed')}{' '}
            <button className="chat-retry" onClick={() => conversations.refetch()}>
              {t('common.retry')}
            </button>
          </div>
        )}
        <div
          className={`chat-unified-layout${selected || explicitSelectionUnavailable || !conversations.isSuccess || items.length === 0 ? ' chat-conversation-open' : ''}`}
        >
          {conversations.isSuccess && (
            <aside className="chat-unified-inbox" aria-label={t('chat.groupListLabel')}>
              <InboxSection
                title={t('chat.familyChats')}
                items={family}
                user={props.user}
                locale={i18n.language}
                onSelect={selectConversation}
                selectedId={selectedId}
              />
              <InboxSection
                title={t('chat.directMessages')}
                items={direct}
                user={props.user}
                locale={i18n.language}
                onSelect={selectConversation}
                selectedId={selectedId}
              />
            </aside>
          )}
          {selected ? (
            <ConversationShell
              key={selectedId}
              conversation={selected}
              messages={messages}
              messagesQuery={messagesQuery}
              locale={i18n.language}
              onBack={openInbox}
              user={props.user}
            />
          ) : (
            <ConversationPlaceholder
              unavailable={explicitSelectionUnavailable}
              empty={conversations.isSuccess && items.length === 0 && !hasExplicitSelection}
            />
          )}
          {pickerOpen && (
            <RecipientPicker
              onClose={() => setPickerOpen(false)}
              onCreated={(conversation) => {
                client.setQueryData<{ items: ChatConversation[] }>(['chat-conversations'], (old) => {
                  if (!old) return { items: [conversation] }
                  return {
                    items: [conversation, ...old.items.filter((item) => item.id !== conversation.id)].sort(
                      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
                    ),
                  }
                })
                setPickerOpen(false)
                selectConversation(conversation)
              }}
            />
          )}
        </div>
      </div>
    </AppShell>
  )
}

function ConversationPlaceholder({ unavailable, empty }: { unavailable: boolean; empty: boolean }) {
  const { t } = useTranslation()
  const title = unavailable ? t('chat.unavailable') : empty ? t('chat.emptyInbox') : t('chat.noConversationSelected')

  return (
    <section className="chat-panel chat-panel-placeholder">
      <div className="chat-messages">
        <h2 className="chat-panel-placeholder-title">{title}</h2>
      </div>
    </section>
  )
}

function RecipientPicker({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated: (conversation: ChatConversation) => void
}) {
  const { t } = useTranslation()
  const dialogRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const people = useQuery({ queryKey: ['chat-people'], queryFn: fetchChatPeople })
  const create = useMutation({
    mutationFn: (person: ChatEligiblePerson) =>
      createChatConversation({ kind: 'PRIVATE', participantIds: [person.id] }),
    onSuccess: onCreated,
  })
  useModalFocus(dialogRef, onClose)
  useEffect(() => searchRef.current?.focus(), [])
  const visiblePeople =
    people.data?.items.filter((person) => person.name.toLocaleLowerCase().includes(query.toLocaleLowerCase())) ?? []

  return (
    <div className="modal-overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div
        className="modal-card chat-recipient-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="chat-recipient-title"
        ref={dialogRef}
      >
        <div className="modal-header">
          <h2 id="chat-recipient-title" className="modal-title">
            {t('chat.newMessage')}
          </h2>
          <button type="button" className="post-detail-modal-close" onClick={onClose} aria-label={t('common.close')}>
            <Icon name="x" size={20} />
          </button>
        </div>
        <div className="chat-recipient-search">
          <Icon name="search" size={18} />
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('chat.searchPeople')}
            aria-label={t('chat.searchPeople')}
            autoComplete="off"
          />
        </div>
        <div className="chat-recipient-results">
          {people.isLoading && <p className="chat-hint">{t('common.loading')}</p>}
          {people.isError && (
            <p className="chat-hint">
              {t('chat.peopleLoadFailed')}{' '}
              <button className="chat-retry" onClick={() => people.refetch()}>
                {t('common.retry')}
              </button>
            </p>
          )}
          {people.isSuccess && visiblePeople.length === 0 && <p className="chat-hint">{t('chat.noPeople')}</p>}
          {visiblePeople.map((person) => (
            <button
              type="button"
              className="chat-recipient-item"
              key={person.id}
              onClick={() => create.mutate(person)}
              disabled={create.isPending}
            >
              <Avatar name={person.name} avatarUrl={person.avatarUrl} size={40} />
              <span>{person.name}</span>
            </button>
          ))}
          {create.isError && <p className="chat-hint">{t('chat.conversationCreateFailed')}</p>}
        </div>
        <div className="modal-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose} aria-label={t('common.close')}>
            {t('common.close')}
          </button>
        </div>
      </div>
    </div>
  )
}

function InboxSection({
  title,
  items,
  user,
  locale,
  onSelect,
  selectedId,
}: {
  title: string
  items: ChatConversation[]
  user: User
  locale: string
  onSelect: (conversation: ChatConversation) => void
  selectedId?: string | null
}) {
  const { t } = useTranslation()
  return (
    <section className="chat-inbox-section">
      <h2>{title}</h2>
      <ul className="chat-inbox-list">
        {items.map((conversation) => {
          const other = conversation.participants.find((participant) => participant.id !== user.id)
          const name = conversation.kind === 'PRIVATE' ? (other?.name ?? title) : (conversation.group?.name ?? title)
          const encrypted = conversation.lastMessage && !isChatEncryptionSupported(conversation.lastMessage.encryption)
          const preview = encrypted
            ? t('chat.encryptedPreview')
            : (conversation.lastMessage?.content ??
              (conversation.lastMessage?.hasAttachment ? t('chat.attachmentPreview') : t('chat.empty')))
          return (
            <li key={conversation.id}>
              <button
                type="button"
                className={`chat-inbox-item${selectedId === conversation.id ? ' chat-inbox-item-active' : ''}`}
                onClick={() => onSelect(conversation)}
              >
                <Avatar
                  name={name}
                  avatarUrl={conversation.kind === 'PRIVATE' ? (other?.avatarUrl ?? null) : null}
                  size={44}
                />
                <span className="chat-inbox-item-main">
                  <span className="chat-inbox-item-heading">
                    <span className="chat-inbox-item-name">{name}</span>
                    {conversation.lastMessage && (
                      <time dateTime={conversation.lastMessage.createdAt}>
                        {new Date(conversation.lastMessage.createdAt).toLocaleDateString(locale, {
                          month: 'short',
                          day: 'numeric',
                        })}
                      </time>
                    )}
                  </span>
                  <span className="chat-inbox-item-preview">{preview}</span>
                </span>
                {conversation.unreadCount > 0 && (
                  <span
                    className="chat-inbox-unread"
                    aria-label={t('chat.unreadCount', { count: conversation.unreadCount })}
                  >
                    {conversation.unreadCount}
                  </span>
                )}
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function ConversationShell({
  conversation,
  messages,
  messagesQuery,
  locale,
  onBack,
  user,
}: {
  conversation: ChatConversation | null
  messages: ChatConversationMessagesPage['items']
  messagesQuery: ReturnType<typeof useInfiniteQuery<ChatConversationMessagesPage>>
  locale: string
  onBack: () => void
  user: User
}) {
  const { t } = useTranslation()
  const client = useQueryClient()
  const [draft, setDraft] = useState('')
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)
  const [replyTo, setReplyTo] = useState<ChatConversationMessage | null>(null)
  const uploads = useComposerUploads()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const messagesRef = useRef<HTMLDivElement>(null)
  const conversationId = conversation?.id
  const send = useMutation({
    mutationFn: async ({ content, attachmentUrl }: { content: string; attachmentUrl?: string }) => {
      const replyTarget = replyTo
      const created =
        replyTarget && conversation?.kind === 'FAMILY'
          ? {
              ...(await sendChatMessage(conversation.group!.id, {
                content: content || undefined,
                attachmentUrl,
                replyToMessageId: replyTarget.id,
              })),
              conversationId: conversationId!,
              encryption: 'none',
              encryptedPayload: null,
            }
          : await sendChatConversationMessage(conversationId!, {
              content: content || undefined,
              attachmentUrl,
              ...(replyTarget ? { replyToMessageId: replyTarget.id } : {}),
            })

      if (!replyTarget) return created

      return {
        ...created,
        replyToMessageId: created.replyToMessageId ?? replyTarget.id,
        replyTo: created.replyTo ?? {
          id: replyTarget.id,
          authorId: replyTarget.authorId,
          authorName: replyTarget.author.name,
          kind: replyTarget.kind,
          content: replyTarget.content,
          attachmentUrl: replyTarget.attachmentUrl,
        },
      }
    },
    onSuccess: (created) => {
      setDraft('')
      setReplyTo(null)
      uploads.clear()
      client.setQueryData<InfiniteData<ChatConversationMessagesPage>>(['chat-messages', conversationId], (old) => {
        if (!old) return old
        const [firstPage, ...rest] = old.pages
        return {
          ...old,
          pages: [{ ...firstPage, items: [created, ...firstPage.items] }, ...rest],
        }
      })
      void client.invalidateQueries({ queryKey: ['chat-conversations'] })
      void client.invalidateQueries({ queryKey: ['chat-unread-conversations'] })
    },
  })
  const removeMessage = useMutation({
    mutationFn: (messageId: string) => deleteChatMessage(messageId),
    onMutate: async (messageId) => {
      const queryKey = ['chat-messages', conversationId]
      await client.cancelQueries({ queryKey })
      const previous = client.getQueryData<InfiniteData<ChatConversationMessagesPage>>(queryKey)
      client.setQueryData<InfiniteData<ChatConversationMessagesPage>>(queryKey, (old) =>
        old
          ? {
              ...old,
              pages: old.pages.map((page) => ({
                ...page,
                items: page.items.filter((item) => item.id !== messageId),
              })),
            }
          : old
      )
      return { previous }
    },
    onError: (_error, _messageId, context) => {
      client.setQueryData(['chat-messages', conversationId], context?.previous)
    },
    onSettled: () => {
      void client.invalidateQueries({ queryKey: ['chat-messages', conversationId] })
      void client.invalidateQueries({ queryKey: ['chat-conversations'] })
      void client.invalidateQueries({ queryKey: ['chat-unread-conversations'] })
    },
  })
  useEffect(() => {
    if (messages.length && messagesRef.current) messagesRef.current.scrollTop = messagesRef.current.scrollHeight
  }, [messages.length])

  async function loadOlder() {
    const element = messagesRef.current
    const previousHeight = element?.scrollHeight ?? 0
    const previousTop = element?.scrollTop ?? 0
    await messagesQuery.fetchNextPage()
    requestAnimationFrame(() => {
      if (element) element.scrollTop = element.scrollHeight - previousHeight + previousTop
    })
  }
  const other = conversation?.participants.find((participant) => participant.id !== user.id)
  const name =
    conversation?.kind === 'PRIVATE'
      ? (other?.name ?? t('chat.unavailable'))
      : (conversation?.group?.name ?? t('chat.unavailable'))

  return (
    <section className="chat-panel">
      <header className="chat-panel-header">
        <button type="button" className="chat-inbox-back" onClick={onBack} aria-label={t('chat.backToInbox')}>
          <span aria-hidden>←</span>
        </button>
        <div className="chat-panel-heading">
          <h2 className="chat-panel-name">{name}</h2>
          <div className="chat-panel-meta">
            {conversation?.kind === 'PRIVATE' ? t('chat.directMessage') : t('chat.familyChat')}
          </div>
        </div>
      </header>
      <div className="chat-messages" ref={messagesRef}>
        {messagesQuery.isLoading && <div className="chat-hint">{t('common.loading')}</div>}
        {messagesQuery.hasNextPage && (
          <button
            type="button"
            className="chat-load-older"
            disabled={messagesQuery.isFetchingNextPage}
            onClick={loadOlder}
          >
            {messagesQuery.isFetchingNextPage ? t('common.loading') : t('chat.loadOlder')}
          </button>
        )}
        {messagesQuery.isError ? (
          <div className="chat-hint">{t('chat.unavailable')}</div>
        ) : (
          messages.map((message) => {
            const encrypted = !isChatEncryptionSupported(message.encryption)
            if (message.kind === 'SYSTEM_MILESTONE') {
              return (
                <div key={message.id} className="chat-system-message">
                  <span className="chat-system-pill">{encrypted ? t('chat.encryptedMessage') : message.content}</span>
                </div>
              )
            }
            return (
              <article
                key={message.id}
                className={`chat-message-row${message.authorId === user.id ? ' chat-message-row-own' : ''}`}
              >
                {message.authorId !== user.id && (
                  <Avatar name={message.author.name} avatarUrl={message.author.avatarUrl} size={32} />
                )}
                <div className="chat-message-main">
                  {message.authorId !== user.id && <div className="chat-message-author">{message.author.name}</div>}
                  {!encrypted && message.replyTo && (
                    <blockquote className="chat-reply-quote">
                      <strong>{message.replyTo.authorName}</strong>
                      <span>{message.replyTo.content ?? t('chat.attachmentPreview')}</span>
                    </blockquote>
                  )}
                  {encrypted ? (
                    <div className={`chat-bubble${message.authorId === user.id ? ' chat-bubble-own' : ''}`}>
                      {t('chat.encryptedMessage')}
                    </div>
                  ) : message.attachmentUrl ? (
                    <button
                      type="button"
                      className={`chat-bubble chat-bubble-attachment${message.authorId === user.id ? ' chat-bubble-own' : ''}`}
                      onClick={() => setLightboxUrl(message.attachmentUrl)}
                      aria-label={t('chat.viewAttachment')}
                    >
                      {isVideoUrl(message.attachmentUrl) ? (
                        <video src={getUploadUrl(message.attachmentUrl)} muted preload="metadata" />
                      ) : (
                        <ShimmerImage
                          src={getUploadUrl(message.attachmentUrl, 'thumbnail')}
                          fallbackSrc={getUploadUrl(message.attachmentUrl)}
                          loading="lazy"
                        />
                      )}
                      {message.content && <span className="chat-bubble-attachment-caption">{message.content}</span>}
                    </button>
                  ) : (
                    <div className={`chat-bubble${message.authorId === user.id ? ' chat-bubble-own' : ''}`}>
                      {message.content}
                    </div>
                  )}
                  <time className="chat-message-time" dateTime={message.createdAt}>
                    {new Date(message.createdAt).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}
                  </time>
                  <div className="chat-message-actions">
                    {!encrypted && (
                      <button
                        type="button"
                        className="chat-message-reply"
                        aria-label={t('chat.replyTo', { name: message.author.name })}
                        onClick={() => setReplyTo(message)}
                      >
                        <Icon name="message-square" size={14} />
                      </button>
                    )}
                    {(message.authorId === user.id || (conversation?.kind === 'FAMILY' && user.isAdmin)) && (
                      <button
                        type="button"
                        className="chat-message-delete"
                        aria-label={t('chat.deleteMessage')}
                        disabled={removeMessage.isPending}
                        onClick={() => {
                          if (window.confirm(t('chat.deleteConfirm'))) removeMessage.mutate(message.id)
                        }}
                      >
                        <Icon name="trash" size={14} />
                      </button>
                    )}
                  </div>
                </div>
              </article>
            )
          })
        )}
      </div>
      {conversation && (
        <form
          className="chat-composer-form"
          onSubmit={(event) => {
            event.preventDefault()
            const content = draft.trim()
            const attachmentUrl = uploads.urls[0]
            if ((content || attachmentUrl) && !send.isPending && !uploads.uploading && !uploads.incomplete) {
              send.mutate({ content, attachmentUrl })
            }
          }}
        >
          {replyTo && (
            <div className="chat-replying">
              <span>{t('chat.replyingTo', { name: replyTo.author.name })}</span>
              <button type="button" onClick={() => setReplyTo(null)} aria-label={t('chat.cancelReply')}>
                <Icon name="x" size={14} />
              </button>
            </div>
          )}
          {uploads.items[0] && (
            <div className="chat-attachment-preview">
              <ComposerUploadPreview
                item={uploads.items[0]}
                livePhoto={uploads.items[0].processing?.kind === 'livePhoto'}
                pending={uploads.items[0].pending}
              />
              <button
                type="button"
                className="chat-attachment-remove"
                onClick={() => uploads.remove(uploads.items[0])}
                aria-label={t('chat.removeAttachment')}
              >
                <Icon name="x" size={12} strokeWidth={2.5} />
              </button>
            </div>
          )}
          {(uploads.error || uploads.limitError) && (
            <div className="chat-upload-error" role="alert">
              <span>{uploads.limitError ?? t('chat.uploadFailed')}</span>
              {uploads.error && (
                <button type="button" className="chat-retry" onClick={() => uploads.retry()}>
                  {t('common.retry')}
                </button>
              )}
            </div>
          )}
          <div className="chat-composer">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,video/mp4,video/quicktime,video/webm"
              hidden
              onChange={async (event) => {
                const file = event.target.files?.[0]
                if (file) await uploads.add([file])
                if (fileInputRef.current) fileInputRef.current.value = ''
              }}
            />
            <button
              type="button"
              className="chat-attach-button"
              onClick={() => fileInputRef.current?.click()}
              aria-label={t('chat.addAttachment')}
              disabled={uploads.count > 0 || uploads.uploading}
            >
              <Icon name="image" size={18} />
            </button>
            <input
              className="chat-input"
              aria-label={t('chat.messageLabel')}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={t('chat.placeholder')}
              maxLength={2000}
            />
            <button
              type="submit"
              className="chat-send-button"
              disabled={
                (!draft.trim() && !uploads.urls[0]) || send.isPending || uploads.uploading || uploads.incomplete
              }
              aria-label={t('chat.send')}
            >
              <Icon name="send" size={18} />
            </button>
          </div>
        </form>
      )}
      {send.isError && <div className="chat-hint">{t('chat.sendFailed')}</div>}
      {lightboxUrl && <Lightbox assetUrls={[lightboxUrl]} initialIndex={0} onClose={() => setLightboxUrl(null)} />}
    </section>
  )
}
