import { useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  createWikiPage,
  fetchGroups,
  fetchMyCircles,
  fetchWikiCategories,
  fetchWikiPage,
  updateWikiPage,
  uploadFiles,
  wikiConflictPage,
  type WikiPage,
} from '@famlin/api-client'
import { Icon } from '@/components/Icon'
import { ScreenHeader } from '@/components/ScreenHeader'
import { WikiContent } from '@/components/WikiContent'
import { isBrowserDecodableImage } from '@/utils/media'
import { WikiShell, type WikiShellProps } from '@/components/WikiShell'
import './WikiPages.css'

// Creating (no pageId) or editing a Family Wiki page (issue #118). The
// content is Markdown in a plain textarea with a small formatting toolbar and
// a preview; "Photo" uploads an image and inserts it at the cursor. Saving an
// edit sends the version it started from, so a concurrent save by someone
// else is caught (409) instead of silently overwritten.
export function WikiEditorPage({
  pageId,
  groupId,
  initialCategory,
  onCancel,
  onSaved,
  ...shell
}: WikiShellProps & {
  pageId?: string
  // New pages only: the family (and category) the page starts in.
  groupId?: string
  initialCategory?: string
  onCancel: () => void
  onSaved: (pageId: string) => void
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const isNew = !pageId
  const pageQuery = useQuery({
    queryKey: ['wiki', 'page', pageId],
    queryFn: () => fetchWikiPage(pageId!),
    enabled: !isNew,
  })
  const groupsQuery = useQuery({ queryKey: ['groups'], queryFn: fetchGroups, enabled: isNew })
  const familyId = isNew ? (groupId ?? groupsQuery.data?.[0]?.id) : pageQuery.data?.groupId
  const family = groupsQuery.data?.find((g) => g.id === familyId)

  const categoriesQuery = useQuery({
    queryKey: ['wiki', 'categories', familyId],
    queryFn: () => fetchWikiCategories(familyId!),
    enabled: !!familyId,
  })
  const circlesQuery = useQuery({
    queryKey: ['circles', familyId],
    queryFn: () => fetchMyCircles(familyId!),
    enabled: isNew && !!familyId,
  })

  const [title, setTitle] = useState('')
  const [emoji, setEmoji] = useState('')
  const [category, setCategory] = useState(initialCategory ?? '')
  const [content, setContent] = useState('')
  const [locked, setLocked] = useState(false)
  const [circleId, setCircleId] = useState('')
  const [base, setBase] = useState<WikiPage | null>(null)
  const [preview, setPreview] = useState(false)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [conflict, setConflict] = useState<WikiPage | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // Seed the form once, from a version fetched for this editor — never the
  // article page's cached copy, which may be outdated and would only lead to
  // a spurious conflict on save.
  const loaded = pageQuery.isFetchedAfterMount ? pageQuery.data : undefined
  // Adjusting state during render (not in an effect) — React's pattern for
  // state derived from a prop/query that arrives later.
  if (loaded && !base) {
    setBase(loaded)
    setTitle(loaded.title)
    setEmoji(loaded.emoji ?? '')
    setCategory(loaded.category ?? '')
    setContent(loaded.content)
    setLocked(loaded.locked)
  }

  const canManage = isNew || !!base?.canManage
  const notEditable = !isNew && loaded && !loaded.canEdit

  function surround(before: string, after = before, placeholder = '') {
    const el = textareaRef.current
    if (!el) return
    const { selectionStart: start, selectionEnd: end } = el
    const selected = content.slice(start, end) || placeholder
    const next = content.slice(0, start) + before + selected + after + content.slice(end)
    setContent(next)
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(start + before.length, start + before.length + selected.length)
    })
  }

  // Prefixes every line touched by the selection ("## ", "- ", "- [ ] ").
  function prefixLines(prefix: string) {
    const el = textareaRef.current
    if (!el) return
    const { selectionStart: start, selectionEnd: end } = el
    const lineStart = content.lastIndexOf('\n', start - 1) + 1
    const block = content.slice(lineStart, end)
    const prefixed = block
      .split('\n')
      .map((line) => prefix + line)
      .join('\n')
    setContent(content.slice(0, lineStart) + prefixed + content.slice(end))
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(lineStart + prefixed.length, lineStart + prefixed.length)
    })
  }

  function insertAtCursor(text: string) {
    const el = textareaRef.current
    const pos = el ? el.selectionEnd : content.length
    const needsBreak = pos > 0 && content[pos - 1] !== '\n'
    const insert = `${needsBreak ? '\n' : ''}${text}\n`
    setContent(content.slice(0, pos) + insert + content.slice(pos))
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(pos + insert.length, pos + insert.length)
    })
  }

  async function onPickPhotos(event: ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files ?? [])].filter(isBrowserDecodableImage)
    event.target.value = ''
    if (!files.length) return
    setUploading(true)
    setError(null)
    try {
      const urls = await uploadFiles(files)
      insertAtCursor(urls.map((url) => `![](${url})`).join('\n'))
    } catch {
      setError(t('wiki.uploadFailed'))
    } finally {
      setUploading(false)
    }
  }

  async function save(event?: FormEvent, overrideBase?: WikiPage) {
    event?.preventDefault()
    if (!title.trim() || !familyId) return
    setSaving(true)
    setError(null)
    try {
      const fields = {
        title: title.trim(),
        emoji: emoji.trim() || null,
        category: category.trim() || null,
        content,
        locked,
      }
      const saved = isNew
        ? await createWikiPage({ groupId: familyId, circleId: circleId || null, ...fields })
        : await updateWikiPage(pageId!, {
            ...fields,
            ...(canManage ? {} : { locked: undefined }),
            baseUpdatedAt: (overrideBase ?? base)?.updatedAt,
          })
      queryClient.setQueryData(['wiki', 'page', saved.id], saved)
      void queryClient.invalidateQueries({ queryKey: ['wiki', 'pages'] })
      void queryClient.invalidateQueries({ queryKey: ['wiki', 'categories'] })
      onSaved(saved.id)
    } catch (err) {
      const current = wikiConflictPage(err)
      if (current) setConflict(current)
      else setError(t('wiki.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  function takeTheirs() {
    if (!conflict) return
    setBase(conflict)
    setTitle(conflict.title)
    setEmoji(conflict.emoji ?? '')
    setCategory(conflict.category ?? '')
    setContent(conflict.content)
    setLocked(conflict.locked)
    setConflict(null)
  }

  function keepMine() {
    if (!conflict) return
    const latest = conflict
    setBase(latest)
    setConflict(null)
    void save(undefined, latest)
  }

  const headerTitle = isNew ? t('wiki.newPage') : t('wiki.editPage')

  return (
    <WikiShell shell={shell}>
      <div className="wiki-column">
        <ScreenHeader title={headerTitle} onBack={onCancel} />

        {!isNew && !loaded && !pageQuery.isError && (
          <p role="status" className="wiki-hint">
            {t('common.loading')}
          </p>
        )}
        {!isNew && pageQuery.isError && (
          <p role="alert" className="wiki-hint">
            {t('wiki.notAvailable')}
          </p>
        )}
        {notEditable && (
          <p role="alert" className="wiki-hint">
            {t('wiki.lockedHint')}
          </p>
        )}

        {(isNew || (base && !notEditable)) && (
          <form className="wiki-editor" onSubmit={save}>
            {isNew && family && <p className="wiki-intro">{t('wiki.inFamily', { family: family.name })}</p>}

            <div className="wiki-editor-row">
              <label className="field wiki-emoji-field">
                <span className="field-label">{t('wiki.emojiLabel')}</span>
                <input
                  className="field-input"
                  value={emoji}
                  onChange={(e) => setEmoji(e.target.value)}
                  maxLength={16}
                  placeholder="📄"
                />
              </label>
              <label className="field">
                <span className="field-label">{t('wiki.titleLabel')}</span>
                <input
                  className="field-input"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={120}
                  required
                  autoFocus={isNew}
                  placeholder={t('wiki.titlePlaceholder')}
                />
              </label>
            </div>

            <div className="wiki-editor-row">
              <label className="field">
                <span className="field-label">{t('wiki.categoryLabel')}</span>
                <input
                  className="field-input"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  maxLength={60}
                  list="wiki-categories"
                  placeholder={t('wiki.categoryPlaceholder')}
                />
                <datalist id="wiki-categories">
                  {(categoriesQuery.data ?? [])
                    .filter((c) => c.name)
                    .map((c) => (
                      <option key={c.name} value={c.name!} />
                    ))}
                </datalist>
              </label>
              {isNew && (circlesQuery.data?.length ?? 0) > 0 && (
                <label className="field">
                  <span className="field-label">{t('wiki.audienceLabel')}</span>
                  <select className="field-input" value={circleId} onChange={(e) => setCircleId(e.target.value)}>
                    <option value="">{t('wiki.audienceFamily')}</option>
                    {circlesQuery.data!.map((circle) => (
                      <option key={circle.id} value={circle.id}>
                        {circle.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
            {!isNew && base?.circle && (
              <p className="wiki-intro">
                <Icon name="users" size={14} /> {t('wiki.circleOnly', { circle: base.circle.name })}
              </p>
            )}

            <div className="wiki-editor-tabs" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={!preview}
                className={`filter-chip${!preview ? ' filter-chip-active' : ''}`}
                onClick={() => setPreview(false)}
              >
                {t('wiki.write')}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={preview}
                className={`filter-chip${preview ? ' filter-chip-active' : ''}`}
                onClick={() => setPreview(true)}
              >
                {t('wiki.preview')}
              </button>
            </div>

            {preview ? (
              <div className="wiki-preview">
                {content.trim() ? (
                  <WikiContent content={content} />
                ) : (
                  <p className="wiki-hint">{t('wiki.emptyPage')}</p>
                )}
              </div>
            ) : (
              <div className="wiki-editor-body">
                <div className="wiki-toolbar" role="toolbar" aria-label={t('wiki.formatting')}>
                  <button type="button" onClick={() => prefixLines('## ')} title={t('wiki.fmtHeading')}>
                    H
                  </button>
                  <button
                    type="button"
                    onClick={() => surround('**', '**', t('wiki.fmtBold'))}
                    title={t('wiki.fmtBold')}
                  >
                    <strong>B</strong>
                  </button>
                  <button
                    type="button"
                    onClick={() => surround('*', '*', t('wiki.fmtItalic'))}
                    title={t('wiki.fmtItalic')}
                  >
                    <em>I</em>
                  </button>
                  <button type="button" onClick={() => prefixLines('- ')} title={t('wiki.fmtList')}>
                    •
                  </button>
                  <button type="button" onClick={() => prefixLines('- [ ] ')} title={t('wiki.fmtChecklist')}>
                    <Icon name="check" size={16} />
                  </button>
                  <button
                    type="button"
                    onClick={() => surround('[', '](https://)', t('wiki.fmtLinkText'))}
                    title={t('wiki.fmtLink')}
                  >
                    <Icon name="external-link" size={16} />
                  </button>
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    disabled={uploading}
                    title={t('wiki.fmtPhoto')}
                  >
                    <Icon name="image" size={16} />
                    {uploading && <span className="wiki-toolbar-status">{t('wiki.uploading')}</span>}
                  </button>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/jpeg,image/png,image/gif,image/webp"
                    multiple
                    hidden
                    onChange={onPickPhotos}
                  />
                </div>
                <textarea
                  ref={textareaRef}
                  className="wiki-textarea"
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  maxLength={50_000}
                  aria-label={t('wiki.contentLabel')}
                  placeholder={t('wiki.contentPlaceholder')}
                />
                <p className="wiki-help">{t('wiki.formatHelp')}</p>
              </div>
            )}

            {canManage && (
              <label className="wiki-lock-toggle">
                <input type="checkbox" checked={locked} onChange={(e) => setLocked(e.target.checked)} />
                <span>
                  <strong>{t('wiki.lockLabel')}</strong> {t('wiki.lockHelp')}
                </span>
              </label>
            )}

            {conflict && (
              <div className="wiki-confirm" role="alert">
                <span>{t('wiki.conflict', { name: conflict.updatedBy?.name ?? t('wiki.someoneElse') })}</span>
                <button type="button" className="btn btn-secondary" onClick={takeTheirs}>
                  {t('wiki.conflictTakeTheirs')}
                </button>
                <button type="button" className="btn btn-secondary" onClick={keepMine}>
                  {t('wiki.conflictKeepMine')}
                </button>
              </div>
            )}
            {error && (
              <p role="alert" className="wiki-error">
                {error}
              </p>
            )}

            <div className="wiki-editor-actions">
              <button type="button" className="btn btn-secondary" onClick={onCancel}>
                {t('common.cancel')}
              </button>
              <button type="submit" className="btn btn-primary" disabled={saving || uploading || !title.trim()}>
                {saving ? t('wiki.saving') : t('wiki.save')}
              </button>
            </div>
          </form>
        )}
      </div>
    </WikiShell>
  )
}
