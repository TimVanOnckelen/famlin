import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, User, Group } from '../api/client';
import { ApiError } from '../api/client';
import i18n from '../i18n';
import { Icon } from './Icon';

export function UsersPage() {
  const { t } = useTranslation();
  const [users, setUsers] = useState<User[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newIsAdmin, setNewIsAdmin] = useState(false);
  const [managingUser, setManagingUser] = useState<User | null>(null);

  const load = () => {
    setLoading(true);
    Promise.all([api.getUsers(), api.getGroups()])
      .then(([page, g]) => {
        setUsers(page.items);
        setNextCursor(page.nextCursor);
        setGroups(g);
        setManagingUser((current) =>
          current ? page.items.find((x) => x.id === current.id) ?? null : null
        );
      })
      .finally(() => setLoading(false));
  };

  const loadMore = async () => {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const page = await api.getUsers({ cursor: nextCursor });
      setUsers((current) => [...current, ...page.items]);
      setNextCursor(page.nextCursor);
    } finally {
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const resetCreateForm = () => {
    setNewName('');
    setNewEmail('');
    setNewPassword('');
    setNewIsAdmin(false);
    setShowCreateForm(false);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    await api.register({
      email: newEmail,
      name: newName,
      password: newPassword,
      isAdmin: newIsAdmin,
    });
    resetCreateForm();
    load();
  };

  const toggleAdmin = async (user: User) => {
    await api.updateUser(user.id, { isAdmin: !user.isAdmin });
    load();
  };

  // The table shows a single push/email toggle per user as a quick bulk
  // on/off switch; per-event-type granularity is managed by the user in the app.
  const isEmailEnabled = (user: User) =>
    user.emailOnNewPost || user.emailOnNewComment || user.emailOnNewLike;

  const toggleEmailNotifications = async (user: User) => {
    const enabled = !isEmailEnabled(user);
    await api.updateUser(user.id, {
      emailOnNewPost: enabled,
      emailOnNewComment: enabled,
      emailOnNewLike: enabled,
    });
    load();
  };

  const isPushEnabled = (user: User) =>
    user.pushOnNewPost || user.pushOnNewComment || user.pushOnNewLike;

  const togglePushNotifications = async (user: User) => {
    const enabled = !isPushEnabled(user);
    await api.updateUser(user.id, {
      pushOnNewPost: enabled,
      pushOnNewComment: enabled,
      pushOnNewLike: enabled,
    });
    load();
  };

  const handleDelete = async (user: User) => {
    if (!confirm(t('users.deleteConfirm', { name: user.name, email: user.email }))) {
      return;
    }
    await api.deleteUser(user.id);
    load();
  };

  const handleResetPassword = async (user: User) => {
    const newPassword = prompt(t('users.resetPasswordPrompt', { name: user.name, email: user.email }));
    if (!newPassword) return;
    if (newPassword.length < 8) {
      alert(t('users.passwordTooShort'));
      return;
    }
    await api.resetPassword(user.id, newPassword);
    alert(t('users.passwordChanged', { name: user.name }));
  };

  if (loading) return <div className="loading">{t('common.loading')}</div>;

  return (
    <>
      <div className="page-header">
        <h2>{t('users.title')}</h2>
        <button onClick={() => setShowCreateForm(!showCreateForm)}>
          {showCreateForm ? t('common.cancel') : t('users.newUser')}
        </button>
      </div>

      {showCreateForm && (
        <div className="card">
          <h3>{t('users.createUser')}</h3>
          <form onSubmit={handleCreate}>
            <div className="row">
              <label style={{ flex: 1 }}>
                {t('users.form.name')}
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  required
                />
              </label>
              <label style={{ flex: 1 }}>
                {t('users.form.email')}
                <input
                  type="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  required
                />
              </label>
              <label style={{ flex: 1 }}>
                {t('users.form.password')}
                <input
                  type="text"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                  minLength={8}
                />
              </label>
              <label style={{ flexDirection: 'row', alignItems: 'center', gap: '0.5rem' }}>
                <input
                  type="checkbox"
                  checked={newIsAdmin}
                  onChange={(e) => setNewIsAdmin(e.target.checked)}
                />
                {t('users.form.admin')}
              </label>
              <button type="submit">{t('users.createUser')}</button>
            </div>
          </form>
        </div>
      )}

      <div className="card">
        {users.length === 0 ? (
          <div className="empty">{t('users.noUsers')}</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>{t('users.table.name')}</th>
                <th>{t('users.table.groups')}</th>
                <th>{t('users.table.admin')}</th>
                <th>{t('users.table.notifications')}</th>
                <th>{t('users.table.memberSince')}</th>
                <th>{t('users.table.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id}>
                  <td>
                    <span className="cell-name">
                      {user.name}
                      {!user.hasPassword && <span className="badge sso">{t('users.table.sso')}</span>}
                    </span>
                    <span className="cell-email">{user.email}</span>
                  </td>
                  <td>
                    <div className="group-badges">
                      {user.groups && user.groups.length > 0 ? (
                        user.groups.map((g) => (
                          <span key={g.id} className="badge">
                            {g.name}
                          </span>
                        ))
                      ) : (
                        <span className="muted">{t('users.noGroups')}</span>
                      )}
                    </div>
                  </td>
                  <td>
                    <label
                      className={`mini-toggle${user.isAdmin ? ' active' : ''}`}
                      title={t('users.table.admin')}
                      onClick={() => toggleAdmin(user)}
                    >
                      <input type="checkbox" checked={user.isAdmin} onChange={() => {}} />
                      <Icon name="shield" size={14} />
                    </label>
                  </td>
                  <td>
                    <div className="toggle-group">
                      <label
                        className={`mini-toggle${isPushEnabled(user) ? ' active' : ''}`}
                        title={t('users.table.pushNotifications')}
                        onClick={() => togglePushNotifications(user)}
                      >
                        <input type="checkbox" checked={isPushEnabled(user)} onChange={() => {}} />
                        <Icon name="bell" size={14} />
                      </label>
                      <label
                        className={`mini-toggle${isEmailEnabled(user) ? ' active' : ''}`}
                        title={t('users.table.emailNotifications')}
                        onClick={() => toggleEmailNotifications(user)}
                      >
                        <input type="checkbox" checked={isEmailEnabled(user)} onChange={() => {}} />
                        <Icon name="mail" size={14} />
                      </label>
                    </div>
                  </td>
                  <td>{new Date(user.createdAt).toLocaleDateString(i18n.language)}</td>
                  <td className="actions">
                    <button
                      className="icon-button"
                      title={t('users.manageGroups')}
                      aria-label={t('users.manageGroups')}
                      onClick={() => setManagingUser(user)}
                    >
                      <Icon name="users" size={15} />
                    </button>
                    <button
                      className="icon-button"
                      title={t('users.password')}
                      aria-label={t('users.password')}
                      onClick={() => handleResetPassword(user)}
                    >
                      <Icon name="key" size={15} />
                    </button>
                    <button
                      className="icon-button danger"
                      title={t('common.delete')}
                      aria-label={t('common.delete')}
                      onClick={() => handleDelete(user)}
                    >
                      <Icon name="trash" size={15} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {nextCursor && (
          <button className="secondary" disabled={loadingMore} onClick={loadMore}>
            {loadingMore ? t('common.loading') : t('common.loadMore')}
          </button>
        )}
      </div>

      {managingUser && (
        <ManageGroupsModal
          user={managingUser}
          groups={groups}
          onClose={() => setManagingUser(null)}
          onChanged={load}
        />
      )}
    </>
  );
}

interface ManageGroupsModalProps {
  user: User;
  groups: Group[];
  onClose: () => void;
  onChanged: () => void;
}

function ManageGroupsModal({ user, groups, onClose, onChanged }: ManageGroupsModalProps) {
  const { t } = useTranslation();
  const [busyGroupId, setBusyGroupId] = useState<string | null>(null);
  const memberGroupIds = new Set((user.groups ?? []).map((g) => g.id));

  const toggleMembership = async (group: Group, isMember: boolean) => {
    setBusyGroupId(group.id);
    try {
      if (isMember) {
        await api.removeGroupMember(group.id, user.id);
      } else {
        await api.addGroupMember(group.id, user.id);
      }
      onChanged();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : t('common.error');
      alert(t('users.membershipError', { error: message }));
    } finally {
      setBusyGroupId(null);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{t('users.manageGroupsFor', { name: user.name })}</h3>
        {groups.length === 0 ? (
          <div className="empty">{t('groups.noGroups')}</div>
        ) : (
          <ul className="membership-list">
            {groups.map((group) => {
              const isMember = memberGroupIds.has(group.id);
              return (
                <li key={group.id} className="membership-row">
                  <span>{group.name}</span>
                  <button
                    className={isMember ? 'danger' : ''}
                    disabled={busyGroupId === group.id}
                    onClick={() => toggleMembership(group, isMember)}
                  >
                    {isMember ? t('common.remove') : t('common.add')}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <div className="modal-actions">
          <button className="secondary" onClick={onClose}>
            {t('common.close')}
          </button>
        </div>
      </div>
    </div>
  );
}
