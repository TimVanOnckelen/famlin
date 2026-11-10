import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { api, fetchServerInfo } from '@famlin/api-client'
import { isAxiosError } from 'axios'
import './ReadOnlyBanner.css'

// The `code` the backend's read-only plugin puts on the 403 it answers every
// blocked write with (backend/src/plugins/readOnly.ts).
const READ_ONLY_ERROR_CODE = 'READ_ONLY'
const NOTICE_DURATION_MS = 6000

export function ReadOnlyBanner() {
  const { t } = useTranslation()
  const { data: serverInfo } = useQuery({
    queryKey: ['server-info'],
    queryFn: fetchServerInfo,
  })

  if (!serverInfo?.readOnly) return null

  return (
    <>
      <div className="read-only-banner">{t('demo.readOnlyBanner')}</div>
      <ReadOnlyActionNotice />
    </>
  )
}

// Every write on a read-only demo is rejected server-side, and most screens
// only show a generic failure (or nothing) for that. Catch those rejections in
// one place and explain them, so a visitor knows it's the demo, not a bug.
function ReadOnlyActionNotice() {
  const { t } = useTranslation()
  const [visibleAt, setVisibleAt] = useState<number | null>(null)

  useEffect(() => {
    const id = api.interceptors.response.use(undefined, (error: unknown) => {
      if (isAxiosError(error) && error.response?.status === 403 && error.response.data?.code === READ_ONLY_ERROR_CODE) {
        setVisibleAt(Date.now())
      }
      return Promise.reject(error)
    })
    return () => api.interceptors.response.eject(id)
  }, [])

  useEffect(() => {
    if (visibleAt === null) return
    const timer = setTimeout(() => setVisibleAt(null), NOTICE_DURATION_MS)
    return () => clearTimeout(timer)
  }, [visibleAt])

  return (
    <div className="read-only-toast-region" role="status" aria-live="polite">
      {visibleAt !== null && (
        <div className="read-only-toast">
          <span>{t('demo.blockedAction')}</span>
          <button
            type="button"
            className="read-only-toast-close"
            onClick={() => setVisibleAt(null)}
            aria-label={t('common.close')}
          >
            ×
          </button>
        </div>
      )}
    </div>
  )
}
