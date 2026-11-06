import { useState, type FormEvent } from 'react'
import { useMutation } from '@tanstack/react-query'
import { isAxiosError } from 'axios'
import { useTranslation } from 'react-i18next'
import { updateMe, type User } from '@famlin/api-client'

export function ProfileDetailsForm({ user, onSaved }: { user: User; onSaved: (user: User) => void }) {
  const { t } = useTranslation()
  const [name, setName] = useState(user.name)
  const [email, setEmail] = useState(user.email)
  const mutation = useMutation({
    mutationFn: (details: { name: string; email: string }) => updateMe(details),
    onSuccess: (updated) => {
      setName(updated.name)
      setEmail(updated.email)
      onSaved(updated)
    },
  })
  const changed = name.trim() !== user.name || email.trim().toLowerCase() !== user.email.toLowerCase()
  const error = mutation.isError
    ? t(
        isAxiosError(mutation.error) && mutation.error.response?.status === 409
          ? 'profile.emailInUse'
          : 'profile.detailsFailed'
      )
    : null
  function submit(event: FormEvent) {
    event.preventDefault()
    if (changed && name.trim() && !mutation.isPending)
      mutation.mutate({ name: name.trim(), email: email.trim().toLowerCase() })
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
        <button className="btn btn-primary" type="submit" disabled={!changed || !name.trim() || mutation.isPending}>
          {mutation.isPending ? t('common.loading') : t('profile.saveDetails')}
        </button>
      </form>
    </section>
  )
}
