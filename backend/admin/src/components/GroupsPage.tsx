import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError, Group, GroupMember, MediaAlbumLink, MediaAlbumSummary, MediaProviderId, Invite, User, NewAssetMode, PostTypeInfo } from '../api/client';
import i18n from '../i18n';
import { avatarColor, initials } from '../avatar';
import { Icon } from './Icon';
import { AddMemberModal } from './AddMemberModal';

export function GroupsPage() {
  const { t } = useTranslation();
  const [groups, setGroups] = useState<Group[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [newMemberId, setNewMemberId] = useState('');
  const [addingMember, setAddingMember] = useState(false);
  const [showAddExisting, setShowAddExisting] = useState(false);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [invitesLoading, setInvitesLoading] = useState(false);
  const [copiedInviteId, setCopiedInviteId] = useState<string | null>(null);
  const [showAddMember, setShowAddMember] = useState(false);
  const [loading, setLoading] = useState(true);

  const [mediaLinks, setMediaLinks] = useState<MediaAlbumLink[]>([]);
  const [mediaLinksLoading, setMediaLinksLoading] = useState(false);
  // One album catalog per media provider. `error` is set when the provider IS
  // configured but the catalog fetch still failed (server down, key revoked,
  // unreadable folder, ...) — distinct from notConfigured so the admin isn't
  // told to "configure it" when it already is. Already-linked albums still
  // load fine either way since they come from Famlin's own DB.
  const [catalogs, setCatalogs] = useState<
    Record<MediaProviderId, { albums: MediaAlbumSummary[] | null; notConfigured: boolean; error: boolean }>
  >({
    immich: { albums: null, notConfigured: false, error: false },
    local: { albums: null, notConfigured: false, error: false },
  });
  const [selectedProvider, setSelectedProvider] = useState<MediaProviderId>('immich');
  const [selectedAlbumId, setSelectedAlbumId] = useState('');
  const [linkingAlbum, setLinkingAlbum] = useState(false);

  const loadCatalog = (provider: MediaProviderId) =>
    api
      .getMediaAlbums(provider)
      .then((albums) =>
        setCatalogs((prev) => ({ ...prev, [provider]: { albums, notConfigured: false, error: false } }))
      )
      .catch((err) => {
        const notConfigured = err instanceof ApiError && err.code === 'not_configured';
        setCatalogs((prev) => ({
          ...prev,
          [provider]: { albums: null, notConfigured, error: !notConfigured },
        }));
      });

  // Group create/edit modal. `formGroup === null` while closed; a Group with an
  // empty id means "create", otherwise "edit".
  const [formGroup, setFormGroup] = useState<Group | null>(null);

  const selectedGroup = groups.find((g) => g.id === selectedId) ?? null;

  const loadGroups = async () => {
    const list = await api.getGroups();
    setGroups(list);
    // Keep a valid selection: default to the first group when none is selected.
    setSelectedId((current) => {
      if (current && list.some((g) => g.id === current)) return current;
      return list[0]?.id ?? null;
    });
    return list;
  };

  useEffect(() => {
    Promise.all([
      loadGroups(),
      api.getAllUsers().then(setUsers),
      loadCatalog('immich'),
      loadCatalog('local'),
    ]).finally(() => setLoading(false));
  }, []);

  const loadMembers = (groupId: string) => {
    setMembersLoading(true);
    api
      .getGroupMembers(groupId)
      .then(setMembers)
      .finally(() => setMembersLoading(false));
  };

  const loadInvites = (groupId: string) => {
    setInvitesLoading(true);
    api
      .getGroupInvites(groupId)
      .then(setInvites)
      .finally(() => setInvitesLoading(false));
  };

  const loadMediaLinks = (groupId: string) => {
    setMediaLinksLoading(true);
    api
      .getGroupMediaAlbums(groupId)
      .then(setMediaLinks)
      .finally(() => setMediaLinksLoading(false));
  };

  useEffect(() => {
    setNewMemberId('');
    setShowAddExisting(false);
    setSelectedAlbumId('');
    if (selectedId) {
      loadMembers(selectedId);
      loadInvites(selectedId);
      loadMediaLinks(selectedId);
    } else {
      setMembers([]);
      setInvites([]);
      setMediaLinks([]);
    }
  }, [selectedId]);

  const handleSubmitForm = async (values: { name: string; description: string; allowedPostTypes: string[] }) => {
    if (formGroup && formGroup.id) {
      await api.updateGroup(formGroup.id, values);
    } else {
      const created = await api.createGroup(values);
      setSelectedId(created.id);
    }
    setFormGroup(null);
    await loadGroups();
  };

  const handleDelete = async (group: Group) => {
    if (!confirm(t('groups.deleteConfirm', { name: group.name }))) return;
    await api.deleteGroup(group.id);
    if (selectedId === group.id) setSelectedId(null);
    await loadGroups();
  };

  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedGroup || !newMemberId) return;
    setAddingMember(true);
    try {
      await api.addGroupMember(selectedGroup.id, newMemberId);
      setNewMemberId('');
      setShowAddExisting(false);
      loadMembers(selectedGroup.id);
      loadGroups();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : t('common.error');
      alert(t('groups.addMemberError', { error: message }));
    } finally {
      setAddingMember(false);
    }
  };

  const handleRemoveMember = async (member: GroupMember) => {
    if (!selectedGroup) return;
    if (!confirm(t('groups.removeMemberConfirm', { name: member.name }))) return;
    try {
      await api.removeGroupMember(selectedGroup.id, member.id);
      loadMembers(selectedGroup.id);
      loadGroups();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : t('common.error');
      alert(t('groups.removeMemberError', { error: message }));
    }
  };

  const handleCopyInviteLink = (invite: Invite) => {
    navigator.clipboard.writeText(invite.link);
    setCopiedInviteId(invite.id);
    setTimeout(() => setCopiedInviteId((current) => (current === invite.id ? null : current)), 2000);
  };

  const handleRevokeInvite = async (invite: Invite) => {
    if (!selectedGroup) return;
    if (!confirm(t('groups.invites.revokeConfirm'))) return;
    try {
      await api.revokeInvite(invite.id);
      loadInvites(selectedGroup.id);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : t('common.error');
      alert(t('groups.invites.revokeError', { error: message }));
    }
  };

  const handleLinkAlbum = async (e: React.FormEvent) => {
    e.preventDefault();
    const albums = catalogs[selectedProvider].albums;
    if (!selectedGroup || !selectedAlbumId || !albums) return;
    const album = albums.find((a) => a.id === selectedAlbumId);
    if (!album) return;
    setLinkingAlbum(true);
    try {
      await api.linkMediaAlbum(selectedGroup.id, {
        provider: selectedProvider,
        externalAlbumId: album.id,
        albumName: album.name,
      });
      setSelectedAlbumId('');
      loadMediaLinks(selectedGroup.id);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : t('common.error');
      alert(t('groups.mediaAlbums.linkError', { error: message }));
    } finally {
      setLinkingAlbum(false);
    }
  };

  const handleUnlinkAlbum = async (link: MediaAlbumLink) => {
    if (!selectedGroup) return;
    if (!confirm(t('groups.mediaAlbums.unlinkConfirm', { name: link.albumName }))) return;
    try {
      await api.unlinkMediaAlbum(link.id);
      loadMediaLinks(selectedGroup.id);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : t('common.error');
      alert(t('groups.mediaAlbums.unlinkError', { error: message }));
    }
  };

  const handleUpdateNewAssetMode = async (link: MediaAlbumLink, newMode: NewAssetMode) => {
    try {
      await api.updateMediaAlbumLink(link.id, { newAssetMode: newMode });
      loadMediaLinks(selectedGroup!.id);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : t('common.error');
      alert(t('groups.mediaAlbums.updateModeError', { error: message }));
    }
  };

  const nonMembers = users.filter((u) => !members.some((m) => m.id === u.id));
  const currentCatalog = catalogs[selectedProvider];
  const linkableAlbums = (currentCatalog.albums ?? []).filter(
    (a) => !mediaLinks.some((link) => link.provider === selectedProvider && link.externalAlbumId === a.id)
  );

  if (loading) return <div className="loading">{t('common.loading')}</div>;

  return (
    <>
      <div className="page-header">
        <h2>{t('groups.title')}</h2>
        <button onClick={() => setFormGroup({ id: '', name: '', description: '', createdAt: '' })}>
          {t('groups.newGroup')}
        </button>
      </div>

      {groups.length === 0 ? (
        <div className="card empty">{t('groups.noGroups')}</div>
      ) : (
        <div className="master-detail">
          {/* Master: group list */}
          <aside className="md-list card">
            {groups.map((group) => (
              <button
                key={group.id}
                className={`md-list-item${group.id === selectedId ? ' active' : ''}`}
                onClick={() => setSelectedId(group.id)}
              >
                <span className="md-list-item-main">
                  <span className="md-list-item-name">{group.name}</span>
                  {group.description && (
                    <span className="md-list-item-desc">{group.description}</span>
                  )}
                </span>
                <span className="badge">
                  {t('groups.memberCount', { count: group.memberCount ?? 0 })}
                </span>
              </button>
            ))}
          </aside>

          {/* Detail: selected group */}
          <section className="md-detail card">
            {!selectedGroup ? (
              <div className="empty">{t('groups.selectGroupHint')}</div>
            ) : (
              <>
                <div className="md-detail-header">
                  <div>
                    <h3 className="md-detail-title">{selectedGroup.name}</h3>
                    <p className="md-detail-desc">
                      {selectedGroup.description || <span className="muted">{t('groups.noDescription')}</span>}
                    </p>
                  </div>
                  <div className="actions">
                    <button className="secondary" onClick={() => setFormGroup(selectedGroup)}>
                      {t('common.edit')}
                    </button>
                    <button className="danger" onClick={() => handleDelete(selectedGroup)}>
                      {t('common.delete')}
                    </button>
                  </div>
                </div>

                <div className="md-section-header">
                  <h4>{t('groups.invites.title')}</h4>
                  <button type="button" className="link-button" onClick={() => setShowAddMember(true)}>
                    {t('members.addMember')}
                  </button>
                </div>
                <p className="hint">{t('groups.invites.hint')}</p>

                {invitesLoading ? (
                  <div className="loading">{t('common.loading')}</div>
                ) : invites.length === 0 ? (
                  <div className="empty">{t('groups.invites.noInvites')}</div>
                ) : (
                  <ul className="member-cards">
                    {invites.map((invite) => {
                      const expired = !invite.usedAt && !!invite.expiresAt && new Date(invite.expiresAt) < new Date();
                      const status = invite.usedAt
                        ? t('groups.invites.statusUsedBy', { name: invite.usedBy?.name ?? t('common.unknown') })
                        : expired
                        ? t('groups.invites.statusExpired')
                        : t('groups.invites.statusActive');
                      const revocable = !invite.usedAt && !expired;

                      return (
                        <li key={invite.id} className="member-card">
                          <span className="member-card-info">
                            <span className="member-card-name">
                              {invite.email || t('groups.invites.anyEmail')}
                              <span className={`badge${revocable ? '' : ' admin'}`}>{status}</span>
                            </span>
                            <span className="member-card-sub">
                              {invite.expiresAt
                                ? t('groups.invites.expiresOn', {
                                    date: new Date(invite.expiresAt).toLocaleDateString(i18n.language),
                                  })
                                : t('groups.invites.neverExpires')}
                              {' · '}
                              {t('groups.invites.createdOn', {
                                date: new Date(invite.createdAt).toLocaleDateString(i18n.language),
                              })}
                            </span>
                          </span>
                          <button type="button" className="secondary" onClick={() => handleCopyInviteLink(invite)}>
                            {copiedInviteId === invite.id ? t('groups.invites.linkCopied') : t('groups.invites.copyLink')}
                          </button>
                          {revocable && (
                            <button
                              className="icon-button danger"
                              title={t('groups.invites.revoke')}
                              aria-label={t('groups.invites.revoke')}
                              onClick={() => handleRevokeInvite(invite)}
                            >
                              <Icon name="x" size={14} />
                            </button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}

                <div className="md-section-header">
                  <h4>{t('groups.memberCount', { count: members.length })}</h4>
                  {!showAddExisting && (
                    <button type="button" className="link-button" onClick={() => setShowAddExisting(true)}>
                      {t('groups.addExistingUser')}
                    </button>
                  )}
                </div>

                {showAddExisting && (
                  <form className="md-add-member" onSubmit={handleAddMember}>
                    <select
                      value={newMemberId}
                      onChange={(e) => setNewMemberId(e.target.value)}
                      disabled={nonMembers.length === 0}
                      autoFocus
                    >
                      <option value="">{t('groups.selectUser')}</option>
                      {nonMembers.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name} ({u.email})
                        </option>
                      ))}
                    </select>
                    <button type="submit" disabled={!newMemberId || addingMember}>
                      {t('groups.addMember')}
                    </button>
                    <button type="button" className="secondary" onClick={() => setShowAddExisting(false)}>
                      {t('common.cancel')}
                    </button>
                  </form>
                )}

                {membersLoading ? (
                  <div className="loading">{t('common.loading')}</div>
                ) : members.length === 0 ? (
                  <div className="empty">{t('groups.noMembers')}</div>
                ) : (
                  <ul className="member-cards">
                    {members.map((member) => (
                      <li key={member.id} className="member-card">
                        <span className="avatar" style={{ background: avatarColor(member.name) }}>
                          {initials(member.name)}
                        </span>
                        <span className="member-card-info">
                          <span className="member-card-name">
                            {member.name}
                            {member.isAdmin && <span className="badge admin">{t('common.admin')}</span>}
                            {!member.hasPassword && <span className="badge sso">{t('users.table.sso')}</span>}
                          </span>
                          <span className="member-card-sub">
                            {member.email} · {t('groups.joinedOn', {
                              date: new Date(member.joinedAt).toLocaleDateString(i18n.language),
                            })}
                          </span>
                        </span>
                        <button
                          className="icon-button danger"
                          title={t('common.remove')}
                          aria-label={t('common.remove')}
                          onClick={() => handleRemoveMember(member)}
                        >
                          <Icon name="x" size={14} />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}

                <div className="md-section-header">
                  <h4>{t('groups.mediaAlbums.title')}</h4>
                  <form className="md-add-member" onSubmit={handleLinkAlbum}>
                    <select
                      value={selectedProvider}
                      onChange={(e) => {
                        setSelectedProvider(e.target.value as MediaProviderId);
                        setSelectedAlbumId('');
                      }}
                      aria-label={t('groups.mediaAlbums.providerLabel')}
                    >
                      <option value="immich">{t('groups.mediaAlbums.providers.immich')}</option>
                      <option value="local">{t('groups.mediaAlbums.providers.local')}</option>
                    </select>
                    {currentCatalog.notConfigured ? (
                      <span className="hint">{t('groups.mediaAlbums.notConfigured')}</span>
                    ) : currentCatalog.error ? (
                      <span className="hint">{t('groups.mediaAlbums.loadError')}</span>
                    ) : (
                      <>
                        <select
                          value={selectedAlbumId}
                          onChange={(e) => setSelectedAlbumId(e.target.value)}
                          disabled={linkableAlbums.length === 0}
                        >
                          <option value="">{t('groups.mediaAlbums.selectAlbum')}</option>
                          {linkableAlbums.map((album) => (
                            <option key={album.id} value={album.id}>
                              {album.name} ({album.assetCount})
                            </option>
                          ))}
                        </select>
                        <button type="submit" disabled={!selectedAlbumId || linkingAlbum}>
                          {t('groups.mediaAlbums.linkAlbum')}
                        </button>
                      </>
                    )}
                  </form>
                </div>

                {mediaLinksLoading ? (
                  <div className="loading">{t('common.loading')}</div>
                ) : mediaLinks.length === 0 ? (
                  <div className="empty">{t('groups.mediaAlbums.noAlbums')}</div>
                ) : (
                  <>
                    <ul className="member-cards">
                      {mediaLinks.map((link) => (
                        <li key={link.id} className="member-card">
                          <span className="member-card-info">
                            <span className="member-card-name">
                              {link.albumName}
                              <span className="badge">{t(`groups.mediaAlbums.providers.${link.provider}`)}</span>
                            </span>
                            <span className="member-card-sub">
                              {t('groups.mediaAlbums.newAssetMode')}:
                              <select
                                value={link.newAssetMode}
                                onChange={(e) => handleUpdateNewAssetMode(link, e.target.value as NewAssetMode)}
                                style={{ marginLeft: '0.5rem', fontSize: '0.9rem' }}
                              >
                                <option value="OFF">{t('groups.mediaAlbums.newAssetMode.off')}</option>
                                <option value="MANUAL">{t('groups.mediaAlbums.newAssetMode.manual')}</option>
                                <option value="AUTO">{t('groups.mediaAlbums.newAssetMode.auto')}</option>
                              </select>
                            </span>
                            {link.newAssetMode !== 'OFF' && (
                              <span className="hint" style={{ marginTop: '0.25rem' }}>
                                {t(`groups.mediaAlbums.newAssetMode.${link.newAssetMode.toLowerCase()}Help`)}
                              </span>
                            )}
                          </span>
                          <button
                            className="icon-button danger"
                            title={t('common.remove')}
                            aria-label={t('common.remove')}
                            onClick={() => handleUnlinkAlbum(link)}
                          >
                            <Icon name="x" size={14} />
                          </button>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </>
            )}
          </section>
        </div>
      )}

      {formGroup && (
        <GroupFormModal
          group={formGroup}
          onClose={() => setFormGroup(null)}
          onSubmit={handleSubmitForm}
        />
      )}

      {showAddMember && selectedGroup && (
        <AddMemberModal
          defaultGroupId={selectedGroup.id}
          onClose={() => setShowAddMember(false)}
          onCreated={() => {
            loadInvites(selectedGroup.id);
            loadMembers(selectedGroup.id);
            loadGroups();
          }}
        />
      )}
    </>
  );
}

interface GroupFormModalProps {
  group: Group;
  onClose: () => void;
  onSubmit: (values: { name: string; description: string; allowedPostTypes: string[] }) => Promise<void>;
}

function GroupFormModal({ group, onClose, onSubmit }: GroupFormModalProps) {
  const { t } = useTranslation();
  const isEdit = !!group.id;
  const [name, setName] = useState(group.name);
  const [description, setDescription] = useState(group.description || '');
  const [saving, setSaving] = useState(false);

  const [postTypes, setPostTypes] = useState<PostTypeInfo[]>([]);
  const [loadingPostTypes, setLoadingPostTypes] = useState(true);
  const [checkedTypes, setCheckedTypes] = useState<Set<string>>(new Set());
  // Guards against re-seeding checkedTypes if this effect somehow re-ran —
  // the initial checked set is derived once from the group's stored value.
  const initializedTypes = useRef(false);

  useEffect(() => {
    api
      .getPostTypes()
      .then(({ items }) => {
        setPostTypes(items);
        if (!initializedTypes.current) {
          initializedTypes.current = true;
          const stored = group.allowedPostTypes;
          // Empty/absent stored array = "all allowed" (default), same
          // convention as allowedEmails — every box starts checked.
          setCheckedTypes(
            !stored || stored.length === 0 ? new Set(items.map((pt) => pt.id)) : new Set(stored)
          );
        }
      })
      .finally(() => setLoadingPostTypes(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleType = (id: string) => {
    setCheckedTypes((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const noTypesSelected = checkedTypes.size === 0;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (noTypesSelected) return;
    setSaving(true);
    try {
      // All boxes checked persists as [] so post types registered later are
      // automatically allowed; a partial selection persists the explicit list.
      const allowedPostTypes = checkedTypes.size === postTypes.length ? [] : Array.from(checkedTypes);
      await onSubmit({ name: name.trim(), description: description.trim(), allowedPostTypes });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{isEdit ? t('groups.editGroup') : t('groups.newGroup')}</h3>
        <form onSubmit={submit}>
          <label>
            {t('groups.form.name')}
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
          </label>
          <label>
            {t('groups.form.description')}
            <input type="text" value={description} onChange={(e) => setDescription(e.target.value)} />
          </label>

          <div>
            <span className="hint" style={{ marginTop: 0 }}>
              {t('groups.form.allowedPostTypes')}
            </span>
            {loadingPostTypes ? (
              <div className="loading">{t('common.loading')}</div>
            ) : (
              <ul className="membership-list">
                {postTypes.map((pt) => (
                  <li key={pt.id} className="membership-row">
                    <span>{t(`postTypes.${pt.id}`, { defaultValue: pt.id })}</span>
                    <input
                      type="checkbox"
                      checked={checkedTypes.has(pt.id)}
                      onChange={() => toggleType(pt.id)}
                    />
                  </li>
                ))}
              </ul>
            )}
            <p className="hint">{t('groups.form.allowedPostTypesHint')}</p>
            {noTypesSelected && !loadingPostTypes && (
              <div className="error">{t('groups.form.allowedPostTypesError')}</div>
            )}
          </div>

          <div className="modal-actions">
            <button type="button" className="secondary" onClick={onClose}>
              {t('common.cancel')}
            </button>
            <button type="submit" disabled={saving || !name.trim() || loadingPostTypes || noTypesSelected}>
              {isEdit ? t('groups.save') : t('groups.add')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

