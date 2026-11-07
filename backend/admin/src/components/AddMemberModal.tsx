import { Tabs, TabsList, TabsTrigger } from '@famlin/ui/tabs'
import { StateMessage } from '@famlin/ui/common/state-message'
import { Button } from '@famlin/ui/button'
import { Input } from '@famlin/ui/input'
import { SelectField } from '@famlin/ui/common/select-field'
import { AdminModal } from './AdminModal'
import { CheckboxField } from './CheckboxField'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api, ApiError, Group, Invite } from '../api/client'

type Mode = 'invite' | 'create'

interface AddMemberModalProps {
  onClose: () => void
  // Called once a member has actually been added (invite generated, or the
  // account created) so parents can refresh their lists. In invite mode this
  // fires as soon as the link is generated — the modal itself stays open to
  // show the link — not when the modal is finally closed.
  onCreated: () => void
  defaultGroupId?: string
  defaultMode?: Mode
}

export function AddMemberModal({ onClose, onCreated, defaultGroupId, defaultMode }: AddMemberModalProps) {
  const { t } = useTranslation()
  const [mode, setMode] = useState<Mode>(defaultMode ?? 'invite')
  const [groups, setGroups] = useState<Group[]>([])
  const [loadingGroups, setLoadingGroups] = useState(true)

  // Invite mode
  const [inviteGroupId, setInviteGroupId] = useState(defaultGroupId ?? '')
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteExpiry, setInviteExpiry] = useState<'7' | '30' | 'never'>('7')
  const [generatingInvite, setGeneratingInvite] = useState(false)
  const [createdInvite, setCreatedInvite] = useState<Invite | null>(null)
  const [copied, setCopied] = useState(false)
  const [inviteError, setInviteError] = useState<string | null>(null)

  // Create mode
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isAdmin, setIsAdmin] = useState(false)
  const [groupIds, setGroupIds] = useState<string[]>(defaultGroupId ? [defaultGroupId] : [])
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  useEffect(() => {
    api
      .getGroups()
      .then((list) => {
        setGroups(list)
        setInviteGroupId((current) => current || list[0]?.id || '')
      })
      .finally(() => setLoadingGroups(false))
  }, [])

  const handleGenerateInvite = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!inviteGroupId) return
    setGeneratingInvite(true)
    setInviteError(null)
    try {
      const invite = await api.createGroupInvite(inviteGroupId, {
        email: inviteEmail.trim() || undefined,
        expiresInDays: inviteExpiry === 'never' ? undefined : Number(inviteExpiry),
      })
      setCreatedInvite(invite)
      onCreated()
    } catch (err) {
      const message = err instanceof ApiError ? err.message : t('common.error')
      setInviteError(t('groups.invites.generateError', { error: message }))
    } finally {
      setGeneratingInvite(false)
    }
  }

  const handleCopyLink = () => {
    if (!createdInvite) return
    navigator.clipboard.writeText(createdInvite.link)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const toggleGroup = (id: string) => {
    setGroupIds((current) => (current.includes(id) ? current.filter((g) => g !== id) : [...current, id]))
  }

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    setCreating(true)
    setCreateError(null)
    try {
      await api.register({ email, name, password, isAdmin, groupIds })
      onCreated()
      onClose()
    } catch (err) {
      const message = err instanceof ApiError ? err.message : t('common.error')
      setCreateError(t('members.createError', { error: message }))
    } finally {
      setCreating(false)
    }
  }

  return (
    <AdminModal title={t('members.addMember')} onClose={onClose} busy={creating || generatingInvite}>
      {!createdInvite && (
        <Tabs value={mode} onValueChange={(value) => setMode(value as Mode)}>
          <TabsList aria-label={t('members.addMember')} className="w-full">
            <TabsTrigger value="invite">{t('members.modeInvite')}</TabsTrigger>
            <TabsTrigger value="create">{t('members.modeCreate')}</TabsTrigger>
          </TabsList>
        </Tabs>
      )}

      <div key={mode} className="animate-in fade-in-0 slide-in-from-bottom-1 duration-200 motion-reduce:animate-none">
        {mode === 'invite' ? (
          createdInvite ? (
            <div>
              <p className="hint">
                {createdInvite.email
                  ? t('members.inviteSentHint', { email: createdInvite.email })
                  : t('groups.invites.hint')}
              </p>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <Input
                  type="text"
                  readOnly
                  value={createdInvite.link}
                  onFocus={(e) => e.target.select()}
                  style={{ flex: 1 }}
                />
                <Button variant="secondary" type="button" className="secondary" onClick={handleCopyLink}>
                  {copied ? t('groups.invites.linkCopied') : t('groups.invites.copyLink')}
                </Button>
              </div>
              <div className="modal-actions">
                <Button type="button" onClick={onClose}>
                  {t('common.done')}
                </Button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleGenerateInvite}>
              <label>
                {t('members.groupLabel')}
                <SelectField
                  value={inviteGroupId}
                  onValueChange={(value) => setInviteGroupId(value)}
                  required
                  disabled={loadingGroups}
                  autoFocus
                  items={[
                    { value: '', label: <>{t('members.selectGroup')}</> },
                    ...groups.map((g) => ({ value: g.id, label: <>{g.name}</> })),
                  ]}
                />
              </label>
              <label>
                {t('groups.invites.emailLabel')}
                <Input
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder={t('groups.invites.emailPlaceholder')}
                />
              </label>
              <label>
                {t('groups.invites.expiresLabel')}
                <SelectField
                  value={inviteExpiry}
                  onValueChange={(value) => setInviteExpiry(value as '7' | '30' | 'never')}
                  items={[
                    { value: '7', label: <>{t('groups.invites.expires7Days')}</> },
                    { value: '30', label: <>{t('groups.invites.expires30Days')}</> },
                    { value: 'never', label: <>{t('groups.invites.expiresNever')}</> },
                  ]}
                />
              </label>
              {inviteError && (
                <StateMessage variant="error" className="error">
                  {inviteError}
                </StateMessage>
              )}
              <div className="modal-actions">
                <Button
                  variant="secondary"
                  type="button"
                  className="secondary"
                  onClick={onClose}
                  disabled={creating || generatingInvite}
                >
                  {t('common.cancel')}
                </Button>
                <Button type="submit" disabled={!inviteGroupId || generatingInvite}>
                  {generatingInvite ? t('groups.invites.generating') : t('groups.invites.generateLink')}
                </Button>
              </div>
            </form>
          )
        ) : (
          <form onSubmit={handleCreate}>
            <label>
              {t('users.form.name')}
              <Input type="text" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
            </label>
            <label>
              {t('users.form.email')}
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </label>
            <label>
              {t('users.form.password')}
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                autoComplete="new-password"
              />
            </label>
            <CheckboxField label={t('users.form.admin')} checked={isAdmin} onChange={setIsAdmin} />

            <div>
              <span className="hint" style={{ marginTop: 0 }}>
                {t('members.groupsLabel')}
              </span>
              {groups.length === 0 ? (
                <StateMessage variant="empty" className="empty">
                  {t('groups.noGroups')}
                </StateMessage>
              ) : (
                <ul className="membership-list">
                  {groups.map((g) => (
                    <li key={g.id} className="membership-row">
                      <CheckboxField
                        label={g.name}
                        checked={groupIds.includes(g.id)}
                        onChange={() => toggleGroup(g.id)}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {createError && (
              <StateMessage variant="error" className="error">
                {createError}
              </StateMessage>
            )}
            <div className="modal-actions">
              <Button
                variant="secondary"
                type="button"
                className="secondary"
                onClick={onClose}
                disabled={creating || generatingInvite}
              >
                {t('common.cancel')}
              </Button>
              <Button type="submit" disabled={creating || !name.trim() || !email.trim() || password.length < 8}>
                {creating ? t('common.loading') : t('users.createUser')}
              </Button>
            </div>
          </form>
        )}
      </div>
    </AdminModal>
  )
}
