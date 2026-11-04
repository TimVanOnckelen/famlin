import { FormEvent, ReactNode, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  createGiftListItem,
  deleteGiftListItem,
  drawGiftList,
  fetchGiftListItems,
  fetchPost,
  getUploadUrl,
  GiftListItem,
  GiftListItemBody,
  GiftListSettingsBody,
  isGiftDrawResetConflict,
  leaveGiftList,
  Post,
  reorderGiftListItems,
  setGiftListParticipants,
  updateGiftListItem,
  updateGiftListSettings,
  uploadFiles,
  User,
} from '@famlin/api-client'
import { AppShell } from '@/components/AppShell'
import { ScreenHeader } from '@/components/ScreenHeader'
import { Avatar } from '@/components/Avatar'
import { AvatarStack } from '@/components/AvatarStack'
import { Badge } from '@/components/Badge'
import { Icon } from '@/components/Icon'
import { GiftListParticipantPicker } from '@/components/GiftListParticipantPicker'
import { formatDayMonth } from '@/utils/time'
import { useDeletePost } from '@/hooks/usePostMutations'
import '@/components/postTypes/GiftListFeedCard.css'
import './GiftListPage.css'

// A gift list (issue #307), routed at /gift-lists/:postId: every
// participant's wishlist, your own editable, plus — for the starter — the
// participants, settings and the Secret Santa draw. Unlike trips and stories
// this page is fully functional on web: desktop is where people paste shop
// links. Mirrors mobile's GiftListScreen.
export function GiftListPage({
  user,
  postId,
  onBack,
  onOpenFeed,
  onOpenPhotos,
  onOpenChat,
  onOpenProfile,
  onOpenFavorites,
  onOpenNotifications,
  onOpenSearch,
  onOpenMembers,
  onLogout,
}: {
  user: User
  postId: string
  onBack: () => void
  onOpenFeed?: () => void
  onOpenPhotos?: () => void
  onOpenChat?: () => void
  onOpenProfile?: () => void
  onOpenFavorites?: () => void
  onOpenNotifications?: () => void
  onOpenSearch?: (groupId?: string) => void
  onOpenMembers?: () => void
  onLogout: () => void
}) {
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const [editingSettings, setEditingSettings] = useState(false)

  const postQuery = useQuery({ queryKey: ['post', postId], queryFn: () => fetchPost(postId) })
  const itemsQuery = useQuery({ queryKey: ['gift-list-items', postId], queryFn: () => fetchGiftListItems(postId) })
  const post = postQuery.data
  const giftList = post?.giftList
  const items = itemsQuery.data ?? []

  function setPost(updated: Post) {
    queryClient.setQueryData(['post', postId], updated)
    queryClient.invalidateQueries({ queryKey: ['posts'] })
    queryClient.invalidateQueries({ queryKey: ['gift-lists'] })
  }

  // Shared by every starter action that might discard the draw: on a 409,
  // ask, then resend with confirmRedraw.
  async function withRedrawConfirm(run: (confirmRedraw: boolean) => Promise<Post>) {
    setError(null)
    try {
      setPost(await run(false))
    } catch (err) {
      if (!isGiftDrawResetConflict(err)) throw err
      if (!window.confirm(t('giftList.redrawConfirm'))) return
      setPost(await run(true))
    }
    queryClient.invalidateQueries({ queryKey: ['gift-list-items', postId] })
  }

  const actionMutation = useMutation({
    mutationFn: (action: () => Promise<unknown>) => action(),
    onError: (err) => setError(apiErrorMessage(err) ?? t('giftList.actionFailed')),
  })

  function shell(children: ReactNode) {
    return (
      <AppShell
        user={user}
        active="feed"
        onFeed={onOpenFeed ?? onBack}
        onPhotos={onOpenPhotos}
        onFavorites={onOpenFavorites}
        onNotifications={onOpenNotifications}
        onMembers={onOpenMembers}
        onSearch={onOpenSearch}
        onChat={onOpenChat}
        onProfile={onOpenProfile ?? (() => {})}
        onLogout={onLogout}
      >
        <div className="gift-page-column">
          <ScreenHeader title={t('giftList.headerTitle')} onBack={onBack} />
          {children}
        </div>
      </AppShell>
    )
  }

  if (postQuery.isLoading || itemsQuery.isLoading)
    return shell(<div className="gift-page-hint">{t('common.loading')}</div>)
  if (!post || !giftList) return shell(<div className="gift-page-hint">{t('giftList.notAvailable')}</div>)

  const recipient = giftList.myRecipient
  // Your own list first, then the person you're buying for, then everyone else.
  const participants = [...giftList.participants].sort(
    (a, b) => rank(a.id) - rank(b.id) || a.name.localeCompare(b.name)
  )
  function rank(id: string) {
    return id === user.id ? 0 : id === recipient?.id ? 1 : 2
  }

  return shell(
    <>
      <section className="gift-page-header">
        <Badge variant="solid">
          <Icon name="gift" size={12} strokeWidth={2.2} />
          {t('giftList.badge')}
        </Badge>
        <h1 className="gift-page-title">{giftList.title}</h1>
        <div className="gift-page-meta">
          {[
            giftList.occasionDate && formatDayMonth(giftList.occasionDate, i18n.language),
            giftList.budget && t('giftList.budgetValue', { budget: giftList.budget }),
          ]
            .filter(Boolean)
            .join(' · ')}
        </div>
        {post.content && <p className="gift-page-description">{post.content}</p>}
        <AvatarStack people={giftList.participants} size={28} max={12} />

        {recipient ? (
          <a
            className="gift-card-recipient gift-page-recipient"
            href={`#wishlist-${recipient.id}`}
            onClick={(e) => {
              // Scroll without a fragment navigation: that would add a history
              // entry the in-app "back" can't tell apart from leaving the app.
              e.preventDefault()
              document.getElementById(`wishlist-${recipient.id}`)?.scrollIntoView({ behavior: 'smooth' })
            }}
          >
            <Avatar name={recipient.name} avatarUrl={recipient.avatarUrl} size={36} />
            <span>{t('giftList.buyingFor', { name: recipient.name })}</span>
            <Icon name="chevron-right" size={18} />
          </a>
        ) : (
          giftList.drawEnabled && <div className="gift-page-hint">{t('giftList.drawPending')}</div>
        )}

        {error && <div className="modal-error">{error}</div>}

        <div className="gift-page-actions">
          {giftList.isManager ? (
            <>
              {giftList.drawEnabled && !giftList.drawn && (
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={actionMutation.isPending || giftList.participants.length < 3}
                  title={giftList.participants.length < 3 ? t('giftList.drawNeedsThree') : undefined}
                  onClick={() => actionMutation.mutate(async () => setPost(await drawGiftList(postId)))}
                >
                  <Icon name="gift" size={16} />
                  {t('giftList.drawCta')}
                </button>
              )}
              <button type="button" className="btn btn-secondary" onClick={() => setEditingSettings((v) => !v)}>
                <Icon name="users" size={16} />
                {t('giftList.manageCta')}
              </button>
              <DeleteGiftListButton post={post} onDeleted={onBack} />
            </>
          ) : (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                if (!window.confirm(t('giftList.leaveConfirm'))) return
                actionMutation.mutate(async () => {
                  await leaveGiftList(postId)
                  queryClient.invalidateQueries({ queryKey: ['posts'] })
                  queryClient.invalidateQueries({ queryKey: ['gift-lists'] })
                  onBack()
                })
              }}
            >
              {t('giftList.leaveCta')}
            </button>
          )}
        </div>
      </section>

      {giftList.isManager && editingSettings && (
        <ManagePanel
          // Re-seeded after every save, so exclusions of someone just removed
          // don't linger in the form and fail the next save.
          key={`${giftList.participants.map((p) => p.id).join()}|${giftList.drawnAt}`}
          post={post}
          selfId={user.id}
          busy={actionMutation.isPending}
          onSaveSettings={(body) =>
            actionMutation.mutate(() =>
              withRedrawConfirm((confirmRedraw) => updateGiftListSettings(postId, { ...body, confirmRedraw }))
            )
          }
          onSaveParticipants={(userIds) =>
            actionMutation.mutate(() =>
              withRedrawConfirm((confirmRedraw) => setGiftListParticipants(postId, userIds, confirmRedraw))
            )
          }
        />
      )}

      {participants.map((participant) => (
        <Wishlist
          key={participant.id}
          postId={postId}
          participant={participant}
          isMine={participant.id === user.id}
          isRecipient={participant.id === recipient?.id}
          items={items.filter((item) => item.ownerId === participant.id)}
        />
      ))}
    </>
  )
}

// The shared post-delete hook drops the list from every cached feed page; a
// component of its own because the hook needs the loaded post.
function DeleteGiftListButton({ post, onDeleted }: { post: Post; onDeleted: () => void }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const deleteMutation = useDeletePost(post)
  return (
    <button
      type="button"
      className="btn btn-secondary"
      disabled={deleteMutation.isPending}
      onClick={() => {
        if (!window.confirm(t('giftList.deleteConfirm'))) return
        deleteMutation.mutate(undefined, {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['gift-lists'] })
            onDeleted()
          },
        })
      }}
    >
      {t('giftList.deleteCta')}
    </button>
  )
}

function apiErrorMessage(err: unknown): string | null {
  return (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? null
}

// One participant's wishlist. Your own is editable: add, edit, delete and
// move items up/down. Nobody can mark anything as bought — by design.
function Wishlist({
  postId,
  participant,
  isMine,
  isRecipient,
  items,
}: {
  postId: string
  participant: { id: string; name: string; avatarUrl: string | null }
  isMine: boolean
  isRecipient: boolean
  items: GiftListItem[]
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [editingId, setEditingId] = useState<string | 'new' | null>(null)

  const mutation = useMutation({
    mutationFn: (action: () => Promise<unknown>) => action(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['gift-list-items', postId] })
      queryClient.invalidateQueries({ queryKey: ['post', postId] })
      setEditingId(null)
    },
  })

  function move(index: number, delta: number) {
    const ids = items.map((i) => i.id)
    const [moved] = ids.splice(index, 1)
    ids.splice(index + delta, 0, moved)
    mutation.mutate(() => reorderGiftListItems(postId, ids))
  }

  return (
    <section
      id={`wishlist-${participant.id}`}
      className={`gift-wishlist${isRecipient ? ' gift-wishlist-recipient' : ''}`}
    >
      <header className="gift-wishlist-header">
        <Avatar name={participant.name} avatarUrl={participant.avatarUrl} size={32} />
        <h2 className="gift-wishlist-title">
          {isMine ? t('giftList.myWishlist') : t('giftList.wishlistOf', { name: participant.name })}
        </h2>
        {isRecipient && <Badge variant="outline">{t('giftList.recipientBadge')}</Badge>}
      </header>

      {items.length === 0 && editingId !== 'new' && (
        <div className="gift-page-hint">{isMine ? t('giftList.myWishlistEmpty') : t('giftList.wishlistEmpty')}</div>
      )}

      <ul className="gift-items">
        {items.map((item, index) =>
          editingId === item.id ? (
            <li key={item.id}>
              <ItemForm
                initial={item}
                busy={mutation.isPending}
                onCancel={() => setEditingId(null)}
                onSave={(body) => mutation.mutate(() => updateGiftListItem(postId, item.id, body))}
              />
            </li>
          ) : (
            <li key={item.id} className="gift-item">
              {item.photoUrl && (
                <img className="gift-item-photo" src={getUploadUrl(item.photoUrl, 'thumbnail')} alt="" loading="lazy" />
              )}
              <div className="gift-item-text">
                <div className="gift-item-title">{item.title}</div>
                {item.note && <div className="gift-item-note">{item.note}</div>}
                {item.url && (
                  <a className="gift-item-link" href={item.url} target="_blank" rel="noopener noreferrer nofollow">
                    <Icon name="external-link" size={13} />
                    {hostOf(item.url)}
                  </a>
                )}
              </div>
              {isMine && (
                <div className="gift-item-actions">
                  <button
                    type="button"
                    className="icon-btn"
                    disabled={index === 0 || mutation.isPending}
                    onClick={() => move(index, -1)}
                    aria-label={t('giftList.moveUp')}
                  >
                    <Icon name="chevron-up" size={16} />
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    disabled={index === items.length - 1 || mutation.isPending}
                    onClick={() => move(index, 1)}
                    aria-label={t('giftList.moveDown')}
                  >
                    <Icon name="chevron-down" size={16} />
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={() => setEditingId(item.id)}
                    aria-label={t('giftList.editItem')}
                  >
                    <Icon name="edit-3" size={16} />
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    disabled={mutation.isPending}
                    onClick={() => {
                      if (window.confirm(t('giftList.deleteItemConfirm')))
                        mutation.mutate(() => deleteGiftListItem(postId, item.id))
                    }}
                    aria-label={t('giftList.deleteItem')}
                  >
                    <Icon name="trash" size={16} />
                  </button>
                </div>
              )}
            </li>
          )
        )}
      </ul>

      {isMine &&
        (editingId === 'new' ? (
          <ItemForm
            busy={mutation.isPending}
            onCancel={() => setEditingId(null)}
            onSave={(body) => mutation.mutate(() => createGiftListItem(postId, body as GiftListItemBody))}
          />
        ) : (
          <button type="button" className="btn btn-secondary" onClick={() => setEditingId('new')}>
            <Icon name="plus" size={16} />
            {t('giftList.addItem')}
          </button>
        ))}
      {mutation.isError && (
        <div className="modal-error">{apiErrorMessage(mutation.error) ?? t('giftList.actionFailed')}</div>
      )}
    </section>
  )
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

function ItemForm({
  initial,
  busy,
  onSave,
  onCancel,
}: {
  initial?: GiftListItem
  busy: boolean
  onSave: (body: Partial<GiftListItemBody>) => void
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const [title, setTitle] = useState(initial?.title ?? '')
  const [note, setNote] = useState(initial?.note ?? '')
  const [url, setUrl] = useState(initial?.url ?? '')
  const [photoUrl, setPhotoUrl] = useState<string | null>(initial?.photoUrl ?? null)
  const [uploading, setUploading] = useState(false)
  const [uploadFailed, setUploadFailed] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const urlValid = !url.trim() || /^https?:\/\/\S+$/i.test(url.trim())

  async function pickPhoto(file: File | undefined) {
    if (!file) return
    setUploading(true)
    setUploadFailed(false)
    try {
      const [uploaded] = await uploadFiles([file])
      setPhotoUrl(uploaded ?? null)
    } catch {
      setUploadFailed(true)
    } finally {
      setUploading(false)
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!title.trim() || !urlValid) return
    onSave({ title: title.trim(), note: note.trim() || null, url: url.trim() || null, photoUrl })
  }

  return (
    <form className="gift-item-form" onSubmit={submit}>
      <input
        className="field-input"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder={t('giftList.itemTitlePlaceholder')}
        maxLength={200}
        autoFocus
      />
      <input
        className="field-input"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder={t('giftList.itemNotePlaceholder')}
        maxLength={1000}
      />
      <input
        className="field-input"
        type="url"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder={t('giftList.itemUrlPlaceholder')}
        maxLength={2000}
        aria-invalid={!urlValid}
      />
      {!urlValid && <div className="modal-error">{t('giftList.itemUrlInvalid')}</div>}
      <div className="gift-item-form-row">
        {photoUrl && <img className="gift-item-photo" src={getUploadUrl(photoUrl, 'thumbnail')} alt="" />}
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => pickPhoto(e.target.files?.[0])} />
        <button
          type="button"
          className="btn btn-secondary"
          disabled={uploading}
          onClick={() => {
            if (fileRef.current) fileRef.current.value = ''
            fileRef.current?.click()
          }}
        >
          <Icon name="image" size={16} />
          {uploading ? t('common.loading') : photoUrl ? t('giftList.changePhoto') : t('giftList.addPhoto')}
        </button>
        {photoUrl && (
          <button type="button" className="btn btn-secondary" onClick={() => setPhotoUrl(null)}>
            {t('giftList.removePhoto')}
          </button>
        )}
      </div>
      {uploadFailed && <div className="modal-error">{t('giftList.photoUploadFailed')}</div>}
      <div className="modal-actions">
        <button type="button" className="btn btn-secondary" onClick={onCancel}>
          {t('common.cancel')}
        </button>
        <button type="submit" className="btn btn-primary" disabled={busy || uploading || !title.trim() || !urlValid}>
          {t('editPost.save')}
        </button>
      </div>
    </form>
  )
}

// The starter's panel: participants, title/date/budget, the draw toggle and
// exclusions. Saving something that would discard an existing draw goes
// through the page's withRedrawConfirm.
function ManagePanel({
  post,
  selfId,
  busy,
  onSaveSettings,
  onSaveParticipants,
}: {
  post: Post
  selfId: string
  busy: boolean
  onSaveSettings: (body: GiftListSettingsBody) => void
  onSaveParticipants: (userIds: string[]) => void
}) {
  const { t } = useTranslation()
  const giftList = post.giftList!
  const [title, setTitle] = useState(giftList.title)
  const [occasionDate, setOccasionDate] = useState(giftList.occasionDate ?? '')
  const [budget, setBudget] = useState(giftList.budget ?? '')
  const [drawEnabled, setDrawEnabled] = useState(giftList.drawEnabled)
  const [exclusions, setExclusions] = useState<Array<[string, string]>>(giftList.exclusions ?? [])
  const [pair, setPair] = useState<[string, string]>(['', ''])
  const [participantIds, setParticipantIds] = useState(
    giftList.participants.map((p) => p.id).filter((id) => id !== selfId)
  )
  const nameOf = (id: string) => giftList.participants.find((p) => p.id === id)?.name ?? '?'

  return (
    <section className="gift-manage">
      <h2 className="gift-wishlist-title">{t('giftList.participants')}</h2>
      <GiftListParticipantPicker
        groupId={post.groupId}
        selfId={selfId}
        selected={participantIds}
        onChange={setParticipantIds}
      />
      <div className="modal-actions">
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy}
          onClick={() => onSaveParticipants(participantIds)}
        >
          {t('giftList.saveParticipants')}
        </button>
      </div>

      <h2 className="gift-wishlist-title">{t('giftList.settings')}</h2>
      <label className="field">
        <span className="field-label">{t('giftList.titleLabel')}</span>
        <input className="field-input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} />
      </label>
      <label className="field">
        <span className="field-label">{t('giftList.occasionDate')}</span>
        <input
          className="field-input"
          type="date"
          value={occasionDate}
          onChange={(e) => setOccasionDate(e.target.value)}
        />
      </label>
      <label className="field">
        <span className="field-label">{t('giftList.budget')}</span>
        <input
          className="field-input"
          value={budget}
          onChange={(e) => setBudget(e.target.value)}
          placeholder={t('giftList.budgetPlaceholder')}
          maxLength={40}
        />
      </label>
      <label className="gift-toggle">
        <input type="checkbox" checked={drawEnabled} onChange={(e) => setDrawEnabled(e.target.checked)} />
        {t('giftList.drawEnabled')}
      </label>

      {drawEnabled && (
        <div className="field">
          <span className="field-label">{t('giftList.exclusions')}</span>
          <span className="field-hint">{t('giftList.exclusionsHint')}</span>
          <ul className="gift-exclusions">
            {exclusions.map(([a, b]) => (
              <li key={`${a}|${b}`}>
                {nameOf(a)} ↔ {nameOf(b)}
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => setExclusions(exclusions.filter(([x, y]) => !(x === a && y === b)))}
                  aria-label={t('giftList.removeExclusion')}
                >
                  <Icon name="x" size={14} />
                </button>
              </li>
            ))}
          </ul>
          <div className="gift-item-form-row">
            {[0, 1].map((slot) => (
              <select
                key={slot}
                className="field-input"
                value={pair[slot]}
                onChange={(e) => setPair(slot === 0 ? [e.target.value, pair[1]] : [pair[0], e.target.value])}
                aria-label={t('giftList.exclusionPerson', { number: slot + 1 })}
              >
                <option value="">—</option>
                {giftList.participants.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            ))}
            <button
              type="button"
              className="btn btn-secondary"
              disabled={!pair[0] || !pair[1] || pair[0] === pair[1]}
              onClick={() => {
                setExclusions([...exclusions, pair])
                setPair(['', ''])
              }}
            >
              {t('giftList.addExclusion')}
            </button>
          </div>
        </div>
      )}

      <div className="modal-actions">
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || !title.trim()}
          onClick={() =>
            onSaveSettings({
              title: title.trim(),
              occasionDate: occasionDate || null,
              budget: budget.trim() || null,
              drawEnabled,
              exclusions,
            })
          }
        >
          {t('giftList.saveSettings')}
        </button>
      </div>
    </section>
  )
}
