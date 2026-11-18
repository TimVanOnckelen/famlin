import { SaveBar } from '@famlin/ui/common/save-bar'
import { Button } from '@famlin/ui/button'
import { useTranslation } from 'react-i18next'
import { Icon } from '../Icon'
import type { SettingsForm } from './useSettingsForm'

// Shown inside the settings <form> once something changed, was saved, or
// failed to save.
export function SettingsSaveBar({ settingsForm }: { settingsForm: SettingsForm }) {
  const { t } = useTranslation()
  const { dirty, success, error, saving, discard } = settingsForm
  if (!dirty && !success && !error) return null
  return (
    <SaveBar
      actions={
        <>
          {dirty && (
            <Button variant="secondary" type="button" className="secondary" onClick={discard} disabled={saving}>
              {t('serverSettings.discard')}
            </Button>
          )}
          <Button type="submit" disabled={saving || !dirty}>
            {saving ? t('serverSettings.saving') : t('serverSettings.saveSettings')}
          </Button>
        </>
      }
    >
      <span className={`save-bar-msg${error ? ' err' : success ? ' ok' : ''}`}>
        {error ? (
          error
        ) : success ? (
          <>
            <Icon name="check" size={15} /> {t('serverSettings.saved')}
          </>
        ) : (
          t('serverSettings.unsavedChanges')
        )}
      </span>
    </SaveBar>
  )
}
