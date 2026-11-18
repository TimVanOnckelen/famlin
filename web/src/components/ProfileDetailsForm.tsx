import { useState, type FormEvent } from 'react'
import { useMutation } from '@tanstack/react-query'
import { isAxiosError } from 'axios'
import { useTranslation } from 'react-i18next'
import { updateMe, type UpdateMeBody, type User } from '@famlin/api-client'

function detailsErrorKey(error: unknown): string {
  if (!isAxiosError(error)) return 'profile.detailsFailed'
  if (error.response?.status === 409) return 'profile.emailInUse'
  switch ((error.response?.data as { code?: string } | undefined)?.code) {
    case 'currentPasswordIncorrect':
    case 'currentPasswordRequired':
      return 'profile.emailChangePasswordIncorrect'
    case 'recentSignInRequired':
      return 'profile.emailChangeRecentSignIn'
    default:
      return 'profile.detailsFailed'
  }
}

export function ProfileDetailsForm({ user, onSaved }: { user: User; onSaved: (user: User) => void }) {
  const { t } = useTranslation()
  const [name, setName] = useState(user.name)
  const [email, setEmail] = useState(user.email)
  // Changing the email needs proof it's really the owner (the server checks):
  // the current password, or — for an account without one — a recent sign-in.
  const [currentPassword, setCurrentPassword] = useState('')
  const mutation = useMutation({
    mutationFn: (details: UpdateMeBody) => updateMe(details),
    onSuccess: (updated) => {
      setName(updated.name)
      setEmail(updated.email)
      setCurrentPassword('')
      onSaved(updated)
    },
  })
  const emailChanged = email.trim().toLowerCase() !== user.email.toLowerCase()
  const changed = name.trim() !== user.name || emailChanged
  const needsPassword = emailChanged && !!user.hasPassword
  const error = mutation.isError ? t(detailsErrorKey(mutation.error)) : null
  function submit(event: FormEvent) {
    event.preventDefault()
    if (!changed || !name.trim() || mutation.isPending) return
    const details: UpdateMeBody = { name: name.trim(), email: email.trim().toLowerCase() }
    if (needsPassword) details.currentPassword = currentPassword
    mutation.mutate(details)
  }
  return (
    <section className="profile-section" aria-labelledby="profile-details-title">
      <h2 className="profile-section-title" id="profile-details-title">
        {t('profile.detailsTitle')}
      </h2>
      <form className="profile-password-form" onSubmit={submit}>
        <label className="field">
          <span className="field-label">{t('profile.displayName')}</span>
          <input
            className="field-input"
            name="name"
            autoComplete="name"
            value={name}
            maxLength={100}
            required
            disabled={mutation.isPending}
            onChange={(event) => {
              setName(event.target.value)
              mutation.reset()
            }}
          />
        </label>
        <label className="field">
          <span className="field-label">{t('profile.emailAddress')}</span>
          <input
            className="field-input"
            name="email"
            type="email"
            autoComplete="email"
            value={email}
            maxLength={254}
            required
            disabled={mutation.isPending}
            aria-invalid={
              error && isAxiosError(mutation.error) && mutation.error.response?.status === 409 ? true : undefined
            }
            onChange={(event) => {
              setEmail(event.target.value)
              mutation.reset()
            }}
          />
        </label>
        {needsPassword && (
          <label className="field">
            <span className="field-label">{t('profile.currentPassword')}</span>
            <input
              className="field-input"
              name="currentPassword"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              required
              disabled={mutation.isPending}
              aria-describedby="profile-email-password-hint"
              onChange={(event) => {
                setCurrentPassword(event.target.value)
                mutation.reset()
              }}
            />
          </label>
        )}
        {needsPassword && (
          <p className="profile-setting-desc" id="profile-email-password-hint">
            {t('profile.emailChangePasswordHint')}
          </p>
        )}
        {error && (
          <p className="profile-error" role="alert">
            {error}
          </p>
        )}
        {mutation.isSuccess && (
          <p className="profile-password-success" role="status">
            {t('profile.detailsSaved')}
          </p>
        )}
        <button
          className="btn btn-primary"
          type="submit"
          disabled={!changed || !name.trim() || (needsPassword && !currentPassword) || mutation.isPending}
        >
          {mutation.isPending ? t('common.loading') : t('profile.saveDetails')}
        </button>
      </form>
    </section>
  )
}
