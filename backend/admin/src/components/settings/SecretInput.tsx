import { Button } from '@famlin/ui/button'
import { Input } from '@famlin/ui/input'
import { useTranslation } from 'react-i18next'
import type { SecretDestination, SecretKey, SettingsForm } from './useSettingsForm'

// Password input for a write-only secret: shows that a value is saved
// without ever holding it, lets the admin replace or remove it, and warns
// when changing the server it belongs to will drop it (the backend does
// that so a saved secret can't be redirected to another host).
export function SecretInput({
  settingsForm,
  name,
  destination,
  onEdit,
  id,
}: {
  settingsForm: SettingsForm
  name: SecretKey
  destination: SecretDestination
  onEdit?: () => void
  id?: string
}) {
  const { t } = useTranslation()
  const { form, settings, updateField } = settingsForm
  if (!form) return null
  const saved = form[`${name}Set`]
  const removing = form[name] === null
  const moved = saved && !form[name] && !removing && settings !== null && form[destination] !== settings[destination]
  return (
    <>
      <Input
        id={id}
        type="password"
        autoComplete="new-password"
        value={form[name] ?? ''}
        placeholder={saved && !removing ? t('serverSettings.secretSaved') : undefined}
        onChange={(e) => {
          updateField(name, e.target.value)
          onEdit?.()
        }}
      />
      {saved && removing && (
        <span className="hint">
          {t('serverSettings.secretWillBeRemoved')}{' '}
          <Button variant="link" type="button" onClick={() => updateField(name, '')}>
            {t('serverSettings.secretKeep')}
          </Button>
        </span>
      )}
      {saved && !removing && !form[name] && (
        <Button
          variant="link"
          type="button"
          onClick={() => {
            updateField(name, null)
            onEdit?.()
          }}
        >
          {t('serverSettings.secretRemove')}
        </Button>
      )}
      {moved && <span className="hint">{t('serverSettings.secretReenter')}</span>}
    </>
  )
}
