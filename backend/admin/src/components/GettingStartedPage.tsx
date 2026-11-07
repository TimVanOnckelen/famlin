import { StateMessage } from '@famlin/ui/common/state-message'
import { PageHeader } from '@famlin/ui/common/page-header'
import { Button } from '@famlin/ui/button'
import { Card } from '@famlin/ui/card'
import { Input } from '@famlin/ui/input'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { api, AdminBranding, Group } from '../api/client'
import { ConnectAppQr } from './ConnectAppQr'
import { loadSetupChecklist } from '../setupChecklist'

const STEP_KEY = 'famlin_admin_wizard_step'
const STEPS = ['family', 'invite', 'app', 'backups', 'done'] as const
type Step = (typeof STEPS)[number]

const readStep = (): number => {
  try {
    const n = Number(localStorage.getItem(STEP_KEY))
    return Number.isInteger(n) && n >= 0 && n < STEPS.length ? n : 0
  } catch {
    return 0
  }
}

const writeStep = (n: number) => {
  try {
    localStorage.setItem(STEP_KEY, String(n))
  } catch {
    // Progress just isn't remembered.
  }
}

// First-run wizard (issue #344), shown right after the first admin exists and
// reachable later at /getting-started. Every step is skippable and writes
// through existing admin endpoints, so skipping leaves a valid state and a
// reload resumes at the remembered step.
export function GettingStartedPage() {
  const { t } = useTranslation()
  const [index, setIndex] = useState(readStep)
  const [group, setGroup] = useState<Group | null>(null)
  const [ready, setReady] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const step: Step = STEPS[index]

  useEffect(() => {
    api
      .getGroups()
      .then((groups) => setGroup(groups[0] ?? null))
      .catch(() => {})
      .finally(() => setReady(true))
  }, [])

  const go = (n: number) => {
    setIndex(n)
    writeStep(n)
  }
  const next = () => go(Math.min(index + 1, STEPS.length - 1))

  if (!ready)
    return (
      <StateMessage variant="loading" className="loading">
        {t('common.loading')}
      </StateMessage>
    )

  return (
    <>
      <PageHeader title={t('wizard.title')} />
      <ol className="wizard-steps" aria-label={t('wizard.title')}>
        {STEPS.map((s, i) => (
          <li key={s} className={i === index ? 'active' : i < index ? 'done' : ''} aria-current={i === index}>
            <Button variant="link" type="button" className="link-button" onClick={() => go(i)}>
              {i + 1}. {t(`wizard.steps.${s}`)}
            </Button>
          </li>
        ))}
      </ol>
      {notice && (
        <div className="hint" role="status">
          {notice}
        </div>
      )}
      <Card className="p-6 gap-4 wizard-card">
        <h3>{t(`wizard.steps.${step}`)}</h3>
        {step === 'family' && <FamilyStep group={group} onGroup={setGroup} onNotice={setNotice} onNext={next} />}
        {step === 'invite' && <InviteStep group={group} onNext={next} onBack={() => go(0)} />}
        {step === 'app' && <AppStep onNext={next} />}
        {step === 'backups' && <BackupsStep onNext={next} />}
        {step === 'done' && <DoneStep />}
      </Card>
    </>
  )
}

function StepActions({
  onNext,
  nextLabel,
  skipLabel,
  nextDisabled,
}: {
  onNext: () => void
  nextLabel?: string
  skipLabel?: string
  nextDisabled?: boolean
}) {
  const { t } = useTranslation()
  return (
    <div className="wizard-actions">
      <Button type="button" onClick={onNext} disabled={nextDisabled}>
        {nextLabel ?? t('wizard.next')}
      </Button>
      {skipLabel !== '' && (
        <Button variant="secondary" type="button" className="secondary" onClick={onNext}>
          {skipLabel ?? t('wizard.skip')}
        </Button>
      )}
    </div>
  )
}

function FamilyStep({
  group,
  onGroup,
  onNotice,
  onNext,
}: {
  group: Group | null
  onGroup: (g: Group) => void
  onNotice: (message: string) => void
  onNext: () => void
}) {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [brand, setBrand] = useState<AdminBranding | null>(null)
  const [preset, setPreset] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // The group created by an earlier attempt: a retry after a failed
  // addGroupMember must not create a second family.
  const [created, setCreated] = useState<Group | null>(null)

  useEffect(() => {
    api
      .getBranding()
      .then((b) => {
        setBrand(b)
        setPreset(b.preset)
      })
      .catch(() => {})
  }, [])

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const me = await api.getMe()
      let target = created
      if (!target) {
        target = await api.createGroup({ name: name.trim() })
        setCreated(target)
      }
      // Existing membership endpoint: the admin is a member of their own family.
      await api.addGroupMember(target.id, me.id)
      onGroup(target)
      if (brand && preset && preset !== brand.preset) {
        try {
          await api.updateBranding({ preset, color: null, name: brand.name })
        } catch {
          onNotice(t('wizard.family.brandingFailed'))
        }
      }
      onNext()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('wizard.failed'))
    } finally {
      setBusy(false)
    }
  }

  if (group) {
    return (
      <>
        <p>{t('wizard.family.exists', { name: group.name })}</p>
        <StepActions onNext={onNext} skipLabel="" />
      </>
    )
  }

  return (
    <form onSubmit={handleCreate}>
      <p className="hint" style={{ marginTop: 0 }}>
        {t('wizard.family.description')}
      </p>
      <label>
        {t('wizard.family.nameLabel')}
        <Input
          type="text"
          value={name}
          maxLength={100}
          placeholder={t('wizard.family.namePlaceholder')}
          onChange={(e) => setName(e.target.value)}
          required
          autoFocus
        />
      </label>
      {brand && brand.presets.length > 0 && (
        <div>
          <span className="branding-label">{t('wizard.family.colorLabel')}</span>
          <div className="branding-swatches" role="radiogroup" aria-label={t('wizard.family.colorLabel')}>
            {brand.presets.map((option) => (
              <Button
                variant="ghost"
                key={option.id}
                type="button"
                role="radio"
                aria-checked={preset === option.id}
                aria-label={option.id}
                title={option.id}
                className={`branding-swatch${preset === option.id ? ' active' : ''}`}
                style={{ background: option.color }}
                onClick={() => setPreset(option.id)}
              />
            ))}
          </div>
        </div>
      )}
      {error && (
        <StateMessage variant="error" className="error" role="alert">
          {error}
        </StateMessage>
      )}
      <div className="wizard-actions">
        <Button type="submit" disabled={busy || !name.trim()}>
          {busy ? t('common.loading') : t('wizard.family.create')}
        </Button>
        <Button variant="secondary" type="button" className="secondary" onClick={onNext} disabled={busy}>
          {t('wizard.skip')}
        </Button>
      </div>
    </form>
  )
}

function InviteStep({ group, onNext, onBack }: { group: Group | null; onNext: () => void; onBack: () => void }) {
  const { t } = useTranslation()
  const [link, setLink] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!group) {
    return (
      <>
        <p>{t('wizard.invite.needFamily')}</p>
        <div className="wizard-actions">
          <Button type="button" onClick={onBack}>
            {t('wizard.back')}
          </Button>
          <Button variant="secondary" type="button" className="secondary" onClick={onNext}>
            {t('wizard.skip')}
          </Button>
        </div>
      </>
    )
  }

  const create = async () => {
    setBusy(true)
    setError(null)
    try {
      const invite = await api.createGroupInvite(group.id, { expiresInDays: 14 })
      setLink(invite.link)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('wizard.failed'))
    } finally {
      setBusy(false)
    }
  }

  const copy = async () => {
    if (!link) return
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
    } catch {
      setError(t('wizard.invite.copyFailed'))
    }
  }

  const share = () => {
    if (!link) return
    navigator
      .share({ title: group.name, text: t('wizard.invite.shareText', { name: group.name }), url: link })
      .catch(() => {})
  }

  return (
    <>
      <p className="hint" style={{ marginTop: 0 }}>
        {t('wizard.invite.description', { name: group.name })}
      </p>
      {link ? (
        <>
          <code className="connect-qr-url">{link}</code>
          <div className="wizard-actions">
            <Button type="button" onClick={copy}>
              {copied ? t('wizard.invite.copied') : t('wizard.invite.copy')}
            </Button>
            {typeof navigator.share === 'function' && (
              <Button variant="secondary" type="button" className="secondary" onClick={share}>
                {t('wizard.invite.share')}
              </Button>
            )}
          </div>
          <p className="hint">{t('wizard.invite.expiryHint')}</p>
        </>
      ) : (
        <div className="wizard-actions">
          <Button type="button" onClick={create} disabled={busy}>
            {busy ? t('common.loading') : t('wizard.invite.create')}
          </Button>
        </div>
      )}
      {error && (
        <StateMessage variant="error" className="error" role="alert">
          {error}
        </StateMessage>
      )}
      <StepActions onNext={onNext} nextLabel={link ? t('wizard.next') : undefined} skipLabel={link ? '' : undefined} />
    </>
  )
}

function AppStep({ onNext }: { onNext: () => void }) {
  const [links, setLinks] = useState<{ appStoreUrl?: string | null; playStoreUrl?: string | null }>({})
  useEffect(() => {
    api
      .getServerInfo()
      .then((info) => setLinks({ appStoreUrl: info.appStoreUrl, playStoreUrl: info.playStoreUrl }))
      .catch(() => {})
  }, [])
  return (
    <>
      <ConnectAppQr appStoreUrl={links.appStoreUrl} playStoreUrl={links.playStoreUrl} />
      <StepActions onNext={onNext} skipLabel="" />
    </>
  )
}

function BackupsStep({ onNext }: { onNext: () => void }) {
  const { t } = useTranslation()
  const [enabled, setEnabled] = useState<boolean | null>(null)
  useEffect(() => {
    api
      .getSettings()
      .then((s) => setEnabled(s.backupEnabled))
      .catch(() => {})
  }, [])
  return (
    <>
      <p>
        {enabled === null ? t('common.loading') : enabled ? t('wizard.backups.on') : t('wizard.backups.off')}{' '}
        <Link to="/settings">{t('wizard.backups.settingsLink')}</Link>
      </p>
      <p className="hint">
        {t('wizard.backups.offsite')}{' '}
        <a href="https://famlin.app/docs/maintenance#keep-backups-off-the-machine" target="_blank" rel="noreferrer">
          {t('wizard.backups.learnMore')}
        </a>
      </p>
      <StepActions onNext={onNext} skipLabel="" />
    </>
  )
}

function DoneStep() {
  const { t } = useTranslation()
  const [allDone, setAllDone] = useState<boolean | null>(null)
  useEffect(() => {
    loadSetupChecklist()
      .then((c) => setAllDone(c.groupExists && c.adminInGroup && c.invited && c.backupsOn))
      .catch(() => {})
  }, [])
  return (
    <>
      <p>{t('wizard.done.description')}</p>
      {allDone === false && <p className="hint">{t('wizard.done.skippedHint')}</p>}
      <div className="wizard-actions">
        <a className="button" href="/">
          {t('wizard.done.openApp')}
        </a>
        <Link className="button secondary" to="/">
          {t('wizard.done.stayInAdmin')}
        </Link>
      </div>
    </>
  )
}
