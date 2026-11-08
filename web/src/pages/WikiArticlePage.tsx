import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { deleteWikiPage, fetchWikiPage } from '@famlin/api-client'
import { Icon } from '@/components/Icon'
import { ScreenHeader } from '@/components/ScreenHeader'
import { WikiContent } from '@/components/WikiContent'
import { WikiMeta, WikiShell, type WikiShellProps } from '@/components/WikiShell'
import './WikiPages.css'

// One Family Wiki page (issue #118), read-only, with Edit/Delete for whoever
// may. A 404 (deleted, another family's, a circle you're not in) shows the
// same "not available" message.
export function WikiArticlePage({
  pageId,
  onBack,
  onEdit,
  onDeleted,
  ...shell
}: WikiShellProps & {
  pageId: string
  onBack: () => void
  onEdit: (pageId: string) => void
  onDeleted: (groupId: string) => void
}) {
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()
  const pageQuery = useQuery({ queryKey: ['wiki', 'page', pageId], queryFn: () => fetchWikiPage(pageId) })
  const page = pageQuery.data
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const deleteMutation = useMutation({
    mutationFn: () => deleteWikiPage(pageId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['wiki'] })
      onDeleted(page!.groupId)
    },
  })

  return (
    <WikiShell shell={shell}>
      <div className="wiki-column">
        <ScreenHeader title={t('wiki.title')} onBack={onBack} />

        {pageQuery.isLoading && (
          <p role="status" className="wiki-hint">
            {t('common.loading')}
          </p>
        )}
        {pageQuery.isError && (
          <p role="alert" className="wiki-hint">
            {t('wiki.notAvailable')}
          </p>
        )}

        {page && (
          <article className="wiki-article">
            <header className="wiki-article-header">
              <h1 className="wiki-article-title">
                {page.emoji && (
                  <span className="wiki-article-emoji" aria-hidden>
                    {page.emoji}
                  </span>
                )}
                {page.title}
              </h1>
              <WikiMeta page={page} className="wiki-row-meta" />
              {(page.canEdit || page.canManage) && (
                <div className="wiki-article-actions">
                  {page.canEdit && (
                    <button type="button" className="btn btn-secondary" onClick={() => onEdit(page.id)}>
                      <Icon name="edit-3" size={16} />
                      {t('wiki.edit')}
                    </button>
                  )}
                  {page.canManage && !confirmingDelete && (
                    <button type="button" className="btn btn-secondary" onClick={() => setConfirmingDelete(true)}>
                      <Icon name="trash" size={16} />
                      {t('wiki.delete')}
                    </button>
                  )}
                </div>
              )}
              {confirmingDelete && (
                <div className="wiki-confirm" role="alert">
                  <span>{t('wiki.deleteConfirm')}</span>
                  <button
                    type="button"
                    className="btn wiki-btn-danger"
                    onClick={() => deleteMutation.mutate()}
                    disabled={deleteMutation.isPending}
                  >
                    {t('wiki.delete')}
                  </button>
                  <button type="button" className="btn btn-secondary" onClick={() => setConfirmingDelete(false)}>
                    {t('common.cancel')}
                  </button>
                  {deleteMutation.isError && <span className="wiki-error">{t('wiki.deleteFailed')}</span>}
                </div>
              )}
            </header>

            {page.content.trim() ? (
              <WikiContent content={page.content} />
            ) : (
              <p className="wiki-hint">{t('wiki.emptyPage')}</p>
            )}

            {page.createdBy && (
              <footer className="wiki-article-footer">
                {t('wiki.createdBy', {
                  name: page.createdBy.name,
                  when: new Date(page.createdAt).toLocaleDateString(i18n.language, { dateStyle: 'long' }),
                })}
              </footer>
            )}
          </article>
        )}
      </div>
    </WikiShell>
  )
}
