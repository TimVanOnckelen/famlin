import { PageHeader } from '@famlin/ui/common/page-header'
import { StateMessage } from '@famlin/ui/common/state-message'
import { Button } from '@famlin/ui/button'
import { Input } from '@famlin/ui/input'
import { SelectField } from '@famlin/ui/common/select-field'
import { Fragment, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { LANGUAGE_NAMES, SUPPORTED_LANGUAGES, type SupportedLanguage } from '../i18n'
import { Icon, type IconName } from './Icon'
import { BrandingSection } from './BrandingSection'
import { SettingToggle } from '@famlin/ui/common/setting-toggle'
import { SettingsCard } from './settings/SettingsCard'
import { SettingsSaveBar } from './settings/SettingsSaveBar'
import { useSettingsForm } from './settings/useSettingsForm'

type SectionId = 'general' | 'branding' | 'access'

// Ranges match the server's validation (backend/src/services/settings.ts).
const LIMIT_FIELDS = [
  { key: 'maxAttachments', min: 10, max: 50 },
  { key: 'maxVideoDurationSeconds', min: 10, max: 1800 },
  { key: 'maxUploadSizeMb', min: 10, max: 2048 },
] as const

// Server-wide settings that aren't a connection to another service. Sign-in
// providers, email, push, photo sources and storage live under Integrations.
export function ServerSettingsPage() {
  const { t } = useTranslation()
  const settingsForm = useSettingsForm()
  const { form, loadError, updateField, save } = settingsForm
  // `?section=access` opens a section directly (links from Integrations).
  const [searchParams] = useSearchParams()
  const requested = searchParams.get('section')
  const [activeSection, setActiveSection] = useState<SectionId>(
    requested === 'branding' || requested === 'access' ? requested : 'general'
  )

  if (loadError)
    return (
      <StateMessage variant="error" className="error">
        {loadError}
      </StateMessage>
    )
  if (!form)
    return (
      <StateMessage variant="loading" className="loading">
        {t('common.loading')}
      </StateMessage>
    )

  const parseList = (value: string) =>
    value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)

  const languageName = LANGUAGE_NAMES[form.defaultLanguage as SupportedLanguage] ?? form.defaultLanguage
  const sections: { id: SectionId; icon: IconName; label: string; status: string }[] = [
    { id: 'general', icon: 'globe', label: t('serverSettings.general'), status: languageName },
    { id: 'branding', icon: 'palette', label: t('branding.title'), status: t('branding.navStatus') },
    {
      id: 'access',
      icon: 'shield',
      label: t('serverSettings.accessControl'),
      status: form.allowedEmails.length
        ? t('serverSettings.accessRestricted', { count: form.allowedEmails.length })
        : t('serverSettings.accessOpen'),
    },
  ]

  return (
    <>
      <PageHeader title={t('serverSettings.title')} />

      <div className="settings-layout">
        <nav className="settings-nav" aria-label={t('serverSettings.title')}>
          {sections.map((section) => (
            <Button
              variant="ghost"
              key={section.id}
              type="button"
              className={`h-auto justify-start whitespace-normal rounded-sm px-3 py-3 settings-nav-item${activeSection === section.id ? ' active' : ''}`}
              onClick={() => setActiveSection(section.id)}
            >
              <span className="settings-nav-icon">
                <Icon name={section.icon} size={15} />
              </span>
              <span className="settings-nav-text">
                <span className="settings-nav-label">{section.label}</span>
                <span className="settings-nav-status">{section.status}</span>
              </span>
            </Button>
          ))}
          <p className="hint settings-nav-hint">
            {t('serverSettings.integrationsMoved')} <Link to="/integrations">{t('layout.integrations')}</Link>
          </p>
        </nav>

        <div className="settings-content">
          {/* Branding saves through its own validated endpoint, so it lives
              outside the generic settings form (and its save bar). */}
          {activeSection === 'branding' && (
            <div className="settings-form">
              <SettingsCard icon="palette" title={t('branding.title')} desc={t('branding.desc')}>
                <BrandingSection />
              </SettingsCard>
            </div>
          )}
          <form onSubmit={save} className="settings-form" hidden={activeSection === 'branding'}>
            {activeSection === 'general' && (
              <SettingsCard icon="globe" title={t('serverSettings.general')} desc={t('serverSettings.generalDesc')}>
                <label>
                  {t('serverSettings.defaultLanguage')}
                  <SelectField
                    value={form.defaultLanguage}
                    onValueChange={(value) => updateField('defaultLanguage', value)}
                    items={[
                      ...SUPPORTED_LANGUAGES.map((lang) => ({ value: lang, label: <>{LANGUAGE_NAMES[lang]}</> })),
                    ]}
                  />
                </label>
                <p className="hint">{t('serverSettings.defaultLanguageHint')}</p>
                <label>
                  {t('serverSettings.publicUrl')}
                  <Input
                    type="url"
                    value={form.publicUrl}
                    onChange={(e) => updateField('publicUrl', e.target.value)}
                    placeholder="https://famlin.example.com"
                  />
                </label>
                {form.publicUrl !== window.location.origin && (
                  <div className="settings-test-row">
                    <Button
                      variant="secondary"
                      type="button"
                      className="secondary"
                      onClick={() => updateField('publicUrl', window.location.origin)}
                    >
                      {t('serverSettings.publicUrlUseCurrent', { url: window.location.origin })}
                    </Button>
                  </div>
                )}
                <p className="hint">{t('serverSettings.publicUrlHint')}</p>
                <div className="row">
                  <label style={{ flex: 1 }}>
                    {t('serverSettings.appStoreUrl')}
                    <Input
                      type="url"
                      value={form.appStoreUrl}
                      onChange={(e) => updateField('appStoreUrl', e.target.value)}
                      placeholder="https://apps.apple.com/app/..."
                    />
                  </label>
                  <label style={{ flex: 1 }}>
                    {t('serverSettings.playStoreUrl')}
                    <Input
                      type="url"
                      value={form.playStoreUrl}
                      onChange={(e) => updateField('playStoreUrl', e.target.value)}
                      placeholder="https://play.google.com/store/apps/details?id=..."
                    />
                  </label>
                </div>
                <p className="hint">{t('serverSettings.storeUrlsHint')}</p>
              </SettingsCard>
            )}

            {activeSection === 'general' && (
              <SettingsCard icon="image" title={t('serverSettings.limits')} desc={t('serverSettings.limitsDesc')}>
                {LIMIT_FIELDS.map(({ key, min, max }) => (
                  <Fragment key={key}>
                    <label>
                      {t(`serverSettings.${key}`)}
                      <Input
                        type="number"
                        required
                        min={min}
                        max={max}
                        step={1}
                        value={form[key]}
                        onChange={(e) => updateField(key, Number(e.target.value))}
                      />
                    </label>
                    <p className="hint">{t(`serverSettings.${key}Hint`, { min, max })}</p>
                  </Fragment>
                ))}
              </SettingsCard>
            )}

            {activeSection === 'general' && (
              <SettingsCard icon="bell" title={t('serverSettings.updates')}>
                <SettingToggle
                  title={t('serverSettings.updateCheck')}
                  hint={t('serverSettings.updateCheckHint')}
                  checked={form.updateCheckEnabled}
                  onCheckedChange={(checked) => updateField('updateCheckEnabled', checked)}
                />
              </SettingsCard>
            )}

            {activeSection === 'general' && (
              <SettingsCard
                icon="message-circle"
                title={t('serverSettings.directMessages')}
                desc={t('serverSettings.directMessagesDesc')}
              >
                <SettingToggle
                  title={t('serverSettings.directMessagesEnabled')}
                  hint={t('serverSettings.directMessagesEnabledHint')}
                  checked={form.directMessagesEnabled}
                  onCheckedChange={(checked) => updateField('directMessagesEnabled', checked)}
                />
                <SettingToggle
                  title={t('serverSettings.directMessagesOnWeb')}
                  hint={t('serverSettings.directMessagesOnWebHint')}
                  checked={form.directMessagesOnWeb}
                  disabled={!form.directMessagesEnabled}
                  onCheckedChange={(checked) => updateField('directMessagesOnWeb', checked)}
                />
                <SettingToggle
                  title={t('serverSettings.e2eDirectMessagesEnabled')}
                  hint={t('serverSettings.e2eDirectMessagesEnabledHint')}
                  checked={form.e2eDirectMessagesEnabled}
                  disabled={!form.directMessagesEnabled}
                  onCheckedChange={(checked) => updateField('e2eDirectMessagesEnabled', checked)}
                />
              </SettingsCard>
            )}

            {activeSection === 'access' && (
              <SettingsCard icon="shield" title={t('serverSettings.accessControl')}>
                <label>
                  {t('serverSettings.allowedEmails')}
                  <Input
                    id="allowedEmails"
                    type="text"
                    value={form.allowedEmails.join(', ')}
                    onChange={(e) => updateField('allowedEmails', parseList(e.target.value))}
                    placeholder="family@example.com"
                  />
                </label>
                <p className="hint">{t('serverSettings.allowedEmailsHint')}</p>
              </SettingsCard>
            )}

            <SettingsSaveBar settingsForm={settingsForm} />
          </form>
        </div>
      </div>
    </>
  )
}
