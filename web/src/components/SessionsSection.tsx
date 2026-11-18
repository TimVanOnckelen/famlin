import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { fetchSessions, revokeOtherSessions, revokeSession, type UserSession } from '@famlin/api-client'
import { describeUserAgent } from '@/utils/userAgent'
import { formatRelativeDate } from '@/utils/time'

const SESSIONS_KEY = ['auth', 'sessions'] as const

// "Signed-in devices" on the profile page: every session this account has
// (server-side sessions — see services/sessions.ts in the backend), with a
// way to sign out one device or all the others. Signing out the current
// device is the regular logout button, so it has no button here.
export function SessionsSection() {
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()
  const sessions = useQuery({ queryKey: SESSIONS_KEY, queryFn: fetchSessions })
  const refresh = () => queryClient.invalidateQueries({ queryKey: SESSIONS_KEY })
  const revokeOne = useMutation({ mutationFn: revokeSession, onSettled: refresh })
  const revokeOthers = useMutation({ mutationFn: revokeOtherSessions, onSettled: refresh })

  function label(session: UserSession) {
    const { browser, os, app } = describeUserAgent(session.userAgent)
    if (app) return t('sessions.mobileApp', { os: os ?? '' }).trim()
    if (browser && os) return t('sessions.browserOn', { browser, os })
    return browser ?? os ?? t('sessions.unknownDevice')
  }

  const items = sessions.data?.items ?? []
  const others = items.filter((session) => !session.current)
  const error = sessions.isError || revokeOne.isError || revokeOthers.isError

  return (
    <section className="profile-section" aria-labelledby="profile-sessions-title">
      <h2 className="profile-section-title" id="profile-sessions-title">
        {t('sessions.title')}
      </h2>
      <p className="profile-setting-desc">{t('sessions.description')}</p>
      {sessions.data && !sessions.data.currentListed && (
        <p className="profile-setting-desc">{t('sessions.currentNotListed')}</p>
      )}
      <ul className="profile-sessions">
        {items.map((session) => (
          <li key={session.id} className="profile-session-row">
            <div className="profile-session-text">
              <div className="profile-setting-label">
                {label(session)}
                {session.current && <span className="profile-session-current">{t('sessions.thisDevice')}</span>}
              </div>
              <div className="profile-setting-desc">
                {t('sessions.lastActive', { when: formatRelativeDate(session.lastUsedAt, i18n.language) })}
              </div>
            </div>
            {!session.current && (
              <button
                type="button"
                className="btn btn-secondary"
                disabled={revokeOne.isPending && revokeOne.variables === session.id}
                onClick={() => revokeOne.mutate(session.id)}
                aria-label={t('sessions.signOutDeviceLabel', { device: label(session) })}
              >
                {t('sessions.signOut')}
              </button>
            )}
          </li>
        ))}
      </ul>
      {error && (
        <p className="profile-error" role="alert">
          {t('sessions.failed')}
        </p>
      )}
      {revokeOthers.isSuccess && (
        <p className="profile-password-success" role="status">
          {t('sessions.othersSignedOut', { count: revokeOthers.data.revoked })}
        </p>
      )}
      {others.length > 0 && (
        <button
          type="button"
          className="btn btn-secondary"
          disabled={revokeOthers.isPending}
          onClick={() => {
            if (window.confirm(t('sessions.signOutOthersConfirm'))) revokeOthers.mutate()
          }}
        >
          {revokeOthers.isPending ? t('common.loading') : t('sessions.signOutOthers')}
        </button>
      )}
    </section>
  )
}
