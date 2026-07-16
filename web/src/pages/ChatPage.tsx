import { ChangeEvent, FormEvent, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { InfiniteData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  api,
  fetchGroups,
  fetchGroupMembers,
  fetchChatMessages,
  sendChatMessage,
  markChatRead,
  fetchChatUnreadCounts,
  getUploadUrl,
  ChatMessage,
  ChatMessagesPage,
  User,
} from '@famlin/api-client';
import { Avatar } from '@/components/Avatar';
import { ShimmerImage } from '@/components/ShimmerImage';
import { Lightbox } from '@/components/Lightbox';
import { formatRelativeDate } from '@/utils/time';
import { isVideoUrl } from '@/utils/media';
import './ChatPage.css';

// Mirrors CommentsSection.tsx's uploadCommentAttachment exactly — same
// endpoint, same "first url of the batch" contract.
async function uploadChatAttachment(file: File): Promise<string> {
  const formData = new FormData();
  formData.append('file', file);
  const response = await api.post<{ urls: string[] }>('/uploads', formData);
  return response.data.urls[0];
}

function dateKey(iso: string): string {
  return new Date(iso).toDateString();
}

// Web counterpart of mobile's per-group chitchat screen, desktop-styled: a
// group picker (skipped when there's only one chitchat-enabled family) next
// to the message panel, since the web app has no group-scoped URL routing.
// No onLogout here — unlike ProfilePage this page has no user menu / logout
// affordance of its own; onBack (mirroring ProfilePage's own back-button
// shell) is the only navigation callback it needs.
export function ChatPage({
  user,
  onBack,
}: {
  user: User;
  onBack: () => void;
}) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [attachmentFile, setAttachmentFile] = useState<File | null>(null);
  const [attachmentPreviewUrl, setAttachmentPreviewUrl] = useState<string | null>(null);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);
  const isFirstLoadRef = useRef(true);

  const groupsQuery = useQuery({ queryKey: ['groups'], queryFn: fetchGroups });
  const chatGroups = (groupsQuery.data ?? []).filter((group) => group.chitchatEnabled);
  // Skip the picker straight to the chat when there's exactly one option.
  const activeGroupId = selectedGroupId ?? (chatGroups.length === 1 ? chatGroups[0].id : null);
  const activeGroup = chatGroups.find((group) => group.id === activeGroupId) ?? null;

  const unreadQuery = useQuery({
    queryKey: ['chat-unread'],
    queryFn: fetchChatUnreadCounts,
    refetchInterval: 30000,
  });
  const unreadByGroup = unreadQuery.data ?? {};

  const membersQuery = useQuery({
    queryKey: ['group-members', activeGroupId],
    queryFn: () => fetchGroupMembers(activeGroupId!),
    enabled: !!activeGroupId,
  });
  const members = membersQuery.data ?? [];

  const messagesQuery = useInfiniteQuery({
    queryKey: ['chatMessages', activeGroupId],
    queryFn: ({ pageParam }) => fetchChatMessages(activeGroupId!, pageParam ?? undefined),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: !!activeGroupId,
    // A web tab doesn't background the same way mobile does, so a plain
    // interval is enough — just skip it while the tab isn't visible.
    refetchInterval: () => (document.visibilityState === 'hidden' ? false : 6000),
  });

  // Pages come back newest-first (per page, and page-over-page); reverse the
  // flattened list for oldest-at-top / newest-at-bottom chat rendering.
  const messages = [...(messagesQuery.data?.pages.flatMap((page) => page.items) ?? [])].reverse();

  const markReadMutation = useMutation({
    mutationFn: (groupId: string) => markChatRead(groupId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chat-unread'] });
    },
  });

  // Mark read whenever the selected group's chat is opened.
  useEffect(() => {
    if (activeGroupId) markReadMutation.mutate(activeGroupId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeGroupId]);

  useEffect(() => {
    isFirstLoadRef.current = true;
  }, [activeGroupId]);

  // Auto-scroll to the newest message on first load, and on any later update
  // only if the user was already near the bottom (so background polling
  // doesn't yank someone away from older messages they scrolled up to read).
  useEffect(() => {
    if (messages.length === 0) return;
    if (isFirstLoadRef.current || isNearBottomRef.current) {
      bottomRef.current?.scrollIntoView({ block: 'end' });
      isFirstLoadRef.current = false;
    }
  }, [messages.length]);

  const sendMutation = useMutation({
    mutationFn: async ({ content, file }: { content: string; file: File | null }) => {
      const attachmentUrl = file ? await uploadChatAttachment(file) : undefined;
      return sendChatMessage(activeGroupId!, { content: content || undefined, attachmentUrl });
    },
    onSuccess: (created) => {
      setDraft('');
      clearAttachment();
      // Mirrors CommentsSection.tsx's onSuccess cache-append pattern, adapted
      // to an infinite query: the new message is the newest, so it goes at
      // the front of the first (newest) page.
      queryClient.setQueryData<InfiniteData<ChatMessagesPage>>(['chatMessages', activeGroupId], (old) => {
        if (!old) return old;
        const [firstPage, ...rest] = old.pages;
        return { ...old, pages: [{ ...firstPage, items: [created, ...firstPage.items] }, ...rest] };
      });
      isNearBottomRef.current = true;
    },
  });

  function handleScroll() {
    const el = containerRef.current;
    if (!el) return;
    isNearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  }

  async function loadOlder() {
    const el = containerRef.current;
    const prevHeight = el?.scrollHeight ?? 0;
    await messagesQuery.fetchNextPage();
    // Keep the viewport pinned to what the user was looking at rather than
    // letting the newly-prepended older messages push it down.
    requestAnimationFrame(() => {
      if (el) el.scrollTop = el.scrollHeight - prevHeight + el.scrollTop;
    });
  }

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
    if ((content || attachmentFile) && !sendMutation.isPending && activeGroupId) {
      sendMutation.mutate({ content, file: attachmentFile });
    }
  }

  function dividerLabel(iso: string): string {
    const date = new Date(iso);
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);
    if (date.toDateString() === today.toDateString()) return t('chat.today');
    if (date.toDateString() === yesterday.toDateString()) return t('chat.yesterday');
    return date.toLocaleDateString(i18n.language, { year: 'numeric', month: 'long', day: 'numeric' });
  }

  let lastDateKey = '';

  return (
    <div className="chat-shell">
      <main className="chat-column">
        <button className="chat-back" onClick={onBack}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path
              d="M15 5l-7 7 7 7"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          {t('chat.backToFeed')}
        </button>

        <h1 className="chat-title">{t('chat.title')}</h1>

        {groupsQuery.isLoading && <div className="chat-hint">{t('common.loading')}</div>}

        {groupsQuery.isSuccess && chatGroups.length === 0 && (
          <div className="chat-empty">
            <div className="chat-empty-emoji">💬</div>
            <p>{t('chat.noChatGroups')}</p>
          </div>
        )}

        {chatGroups.length > 0 && (
          <div className="chat-layout">
            {chatGroups.length > 1 && (
              <aside className="chat-sidebar" aria-label={t('chat.groupListLabel')}>
                <ul className="chat-group-list">
                  {chatGroups.map((group) => (
                    <li key={group.id}>
                      <button
                        className={`chat-group-item${activeGroupId === group.id ? ' chat-group-item-active' : ''}`}
                        onClick={() => setSelectedGroupId(group.id)}
                      >
                        <span className="chat-group-item-name">{group.name}</span>
                        {(unreadByGroup[group.id] ?? 0) > 0 && (
                          <span className="chat-group-unread-dot" aria-hidden />
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              </aside>
            )}

            {activeGroupId && activeGroup && (
              <section className="chat-panel">
                <header className="chat-panel-header">
                  <div className="chat-panel-avatars">
                    {members.slice(0, 3).map((member) => (
                      <span key={member.id} className="chat-avatar-overlap">
                        <Avatar name={member.name} avatarUrl={member.avatarUrl} size={38} />
                      </span>
                    ))}
                  </div>
                  <div className="chat-panel-heading">
                    <div className="chat-panel-name">{activeGroup.name}</div>
                    <div className="chat-panel-meta">{t('chat.memberCount', { count: members.length })}</div>
                  </div>
                </header>

                <div className="chat-messages" ref={containerRef} onScroll={handleScroll}>
                  {messagesQuery.isLoading && <div className="chat-hint">{t('common.loading')}</div>}

                  {messagesQuery.isError && (
                    <div className="chat-hint">
                      {t('chat.loadFailed')}{' '}
                      <button className="chat-retry" onClick={() => messagesQuery.refetch()}>
                        {t('common.retry')}
                      </button>
                    </div>
                  )}

                  {messagesQuery.isSuccess && messages.length === 0 && (
                    <div className="chat-hint">{t('chat.empty')}</div>
                  )}

                  {messagesQuery.hasNextPage && (
                    <button
                      type="button"
                      className="chat-load-older"
                      onClick={loadOlder}
                      disabled={messagesQuery.isFetchingNextPage}
                    >
                      {messagesQuery.isFetchingNextPage ? t('common.loading') : t('chat.loadOlder')}
                    </button>
                  )}

                  {messages.map((message) => {
                    const key = dateKey(message.createdAt);
                    const showDivider = key !== lastDateKey;
                    lastDateKey = key;
                    return (
                      <div key={message.id} className="chat-message-group">
                        {showDivider && (
                          <div className="chat-date-divider">
                            <span>{dividerLabel(message.createdAt)}</span>
                          </div>
                        )}
                        {message.kind === 'SYSTEM_MILESTONE' ? (
                          <div className="chat-system-message">
                            <span className="chat-system-pill">{message.content}</span>
                          </div>
                        ) : (
                          <ChatBubble
                            message={message}
                            isOwn={message.authorId === user.id}
                            onOpenAttachment={setLightboxUrl}
                          />
                        )}
                      </div>
                    );
                  })}

                  <div ref={bottomRef} />
                </div>

                <form className="chat-composer-form" onSubmit={submit}>
                  {attachmentPreviewUrl && (
                    <div className="chat-attachment-preview">
                      {attachmentFile?.type.startsWith('video/') ? (
                        <video src={attachmentPreviewUrl} muted />
                      ) : (
                        <img src={attachmentPreviewUrl} alt="" />
                      )}
                      <button
                        type="button"
                        className="chat-attachment-remove"
                        onClick={clearAttachment}
                        aria-label={t('chat.removeAttachment')}
                      >
                        ×
                      </button>
                    </div>
                  )}
                  <div className="chat-composer">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*,video/mp4,video/quicktime,video/webm"
                      hidden
                      onChange={pickAttachment}
                    />
                    <button
                      type="button"
                      className="chat-attach-button"
                      onClick={() => fileInputRef.current?.click()}
                      aria-label={t('chat.addAttachment')}
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                        <rect x="3" y="3" width="18" height="18" rx="3" stroke="currentColor" strokeWidth="2" />
                        <circle cx="9" cy="9" r="2" stroke="currentColor" strokeWidth="2" />
                        <path d="M21 15l-5-5L5 21" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
                      </svg>
                    </button>
                    <input
                      className="chat-input"
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      placeholder={t('chat.placeholder')}
                      maxLength={2000}
                    />
                    <button
                      type="submit"
                      className="chat-send-button"
                      disabled={(!draft.trim() && !attachmentFile) || sendMutation.isPending}
                      aria-label={t('chat.send')}
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                        <path
                          d="M22 2L11 13M22 2L15 22l-4-9-9-4 20-7z"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </button>
                  </div>
                </form>
                {sendMutation.isError && <div className="chat-hint">{t('chat.sendFailed')}</div>}
              </section>
            )}
          </div>
        )}
      </main>

      {lightboxUrl && <Lightbox assetUrls={[lightboxUrl]} initialIndex={0} onClose={() => setLightboxUrl(null)} />}
    </div>
  );
}

function ChatBubble({
  message,
  isOwn,
  onOpenAttachment,
}: {
  message: ChatMessage;
  isOwn: boolean;
  onOpenAttachment: (assetUrl: string) => void;
}) {
  const { t, i18n } = useTranslation();

  return (
    <div className={`chat-message-row${isOwn ? ' chat-message-row-own' : ''}`}>
      {!isOwn && <Avatar name={message.author.name} avatarUrl={message.author.avatarUrl} size={32} />}
      <div className="chat-message-main">
        {!isOwn && <div className="chat-message-author">{message.author.name}</div>}
        {message.attachmentUrl ? (
          <button
            type="button"
            className={`chat-bubble chat-bubble-attachment${isOwn ? ' chat-bubble-own' : ''}`}
            onClick={() => onOpenAttachment(message.attachmentUrl!)}
            aria-label={t('chat.viewAttachment')}
          >
            {isVideoUrl(message.attachmentUrl) ? (
              <video src={getUploadUrl(message.attachmentUrl)} muted preload="metadata" />
            ) : (
              <ShimmerImage src={getUploadUrl(message.attachmentUrl)} loading="lazy" />
            )}
            {message.content && <span className="chat-bubble-attachment-caption">{message.content}</span>}
          </button>
        ) : (
          <div className={`chat-bubble${isOwn ? ' chat-bubble-own' : ''}`}>{message.content}</div>
        )}
        <div className="chat-message-time">{formatRelativeDate(message.createdAt, i18n.language)}</div>
      </div>
    </div>
  );
}
