import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError, Group, Invite } from '../api/client';

type Mode = 'invite' | 'create';

interface AddMemberModalProps {
  onClose: () => void;
  // Called once a member has actually been added (invite generated, or the
  // account created) so parents can refresh their lists. In invite mode this
  // fires as soon as the link is generated — the modal itself stays open to
  // show the link — not when the modal is finally closed.
  onCreated: () => void;
  defaultGroupId?: string;
  defaultMode?: Mode;
}

export function AddMemberModal({ onClose, onCreated, defaultGroupId, defaultMode }: AddMemberModalProps) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<Mode>(defaultMode ?? 'invite');
  const [groups, setGroups] = useState<Group[]>([]);
  const [loadingGroups, setLoadingGroups] = useState(true);

  // Invite mode
  const [inviteGroupId, setInviteGroupId] = useState(defaultGroupId ?? '');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteExpiry, setInviteExpiry] = useState<'7' | '30' | 'never'>('7');
  const [generatingInvite, setGeneratingInvite] = useState(false);
  const [createdInvite, setCreatedInvite] = useState<Invite | null>(null);
  const [copied, setCopied] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);

  // Create mode
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);
  const [groupIds, setGroupIds] = useState<string[]>(defaultGroupId ? [defaultGroupId] : []);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getGroups()
      .then((list) => {
        setGroups(list);
        setInviteGroupId((current) => current || list[0]?.id || '');
      })
      .finally(() => setLoadingGroups(false));
  }, []);

  const handleGenerateInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteGroupId) return;
    setGeneratingInvite(true);
    setInviteError(null);
    try {
      const invite = await api.createGroupInvite(inviteGroupId, {
        email: inviteEmail.trim() || undefined,
        expiresInDays: inviteExpiry === 'never' ? undefined : Number(inviteExpiry),
      });
      setCreatedInvite(invite);
      onCreated();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : t('common.error');
      setInviteError(t('groups.invites.generateError', { error: message }));
    } finally {
      setGeneratingInvite(false);
    }
  };

  const handleCopyLink = () => {
    if (!createdInvite) return;
    navigator.clipboard.writeText(createdInvite.link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const toggleGroup = (id: string) => {
    setGroupIds((current) => (current.includes(id) ? current.filter((g) => g !== id) : [...current, id]));
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setCreateError(null);
    try {
      await api.register({ email, name, password, isAdmin, groupIds });
      onCreated();
      onClose();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : t('common.error');
      setCreateError(t('members.createError', { error: message }));
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{t('members.addMember')}</h3>

        {!createdInvite && (
          <div className="seg-tabs" style={{ marginBottom: '1rem' }}>
            <button
              type="button"
              className={`seg-tab${mode === 'invite' ? ' active' : ''}`}
              onClick={() => setMode('invite')}
            >
              {t('members.modeInvite')}
            </button>
            <button
              type="button"
              className={`seg-tab${mode === 'create' ? ' active' : ''}`}
              onClick={() => setMode('create')}
            >
              {t('members.modeCreate')}
            </button>
          </div>
        )}

        {mode === 'invite' ? (
          createdInvite ? (
            <div>
              <p className="hint">
                {createdInvite.email
                  ? t('members.inviteSentHint', { email: createdInvite.email })
                  : t('groups.invites.hint')}
              </p>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <input
                  type="text"
                  readOnly
                  value={createdInvite.link}
                  onFocus={(e) => e.target.select()}
                  style={{ flex: 1 }}
                />
                <button type="button" className="secondary" onClick={handleCopyLink}>
                  {copied ? t('groups.invites.linkCopied') : t('groups.invites.copyLink')}
                </button>
              </div>
              <div className="modal-actions">
                <button type="button" onClick={onClose}>
                  {t('common.done')}
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleGenerateInvite}>
              <label>
                {t('members.groupLabel')}
                <select
                  value={inviteGroupId}
                  onChange={(e) => setInviteGroupId(e.target.value)}
                  required
                  disabled={loadingGroups}
                  autoFocus
                >
                  <option value="">{t('members.selectGroup')}</option>
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {t('groups.invites.emailLabel')}
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder={t('groups.invites.emailPlaceholder')}
                />
              </label>
              <label>
                {t('groups.invites.expiresLabel')}
                <select
                  value={inviteExpiry}
                  onChange={(e) => setInviteExpiry(e.target.value as '7' | '30' | 'never')}
                >
                  <option value="7">{t('groups.invites.expires7Days')}</option>
                  <option value="30">{t('groups.invites.expires30Days')}</option>
                  <option value="never">{t('groups.invites.expiresNever')}</option>
                </select>
              </label>
              {inviteError && <div className="error">{inviteError}</div>}
              <div className="modal-actions">
                <button type="button" className="secondary" onClick={onClose}>
                  {t('common.cancel')}
                </button>
                <button type="submit" disabled={!inviteGroupId || generatingInvite}>
                  {generatingInvite ? t('groups.invites.generating') : t('groups.invites.generateLink')}
                </button>
              </div>
            </form>
          )
        ) : (
          <form onSubmit={handleCreate}>
            <label>
              {t('users.form.name')}
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
            </label>
            <label>
              {t('users.form.email')}
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </label>
            <label>
              {t('users.form.password')}
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                autoComplete="new-password"
              />
            </label>
            <label style={{ flexDirection: 'row', alignItems: 'center', gap: '0.5rem' }}>
              <input type="checkbox" checked={isAdmin} onChange={(e) => setIsAdmin(e.target.checked)} />
              {t('users.form.admin')}
            </label>

            <div>
              <span className="hint" style={{ marginTop: 0 }}>
                {t('members.groupsLabel')}
              </span>
              {groups.length === 0 ? (
                <div className="empty">{t('groups.noGroups')}</div>
              ) : (
                <ul className="membership-list">
                  {groups.map((g) => (
                    <li key={g.id} className="membership-row">
                      <span>{g.name}</span>
                      <input
                        type="checkbox"
                        checked={groupIds.includes(g.id)}
                        onChange={() => toggleGroup(g.id)}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {createError && <div className="error">{createError}</div>}
            <div className="modal-actions">
              <button type="button" className="secondary" onClick={onClose}>
                {t('common.cancel')}
              </button>
              <button type="submit" disabled={creating || !name.trim() || !email.trim() || password.length < 8}>
                {creating ? t('common.loading') : t('users.createUser')}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
