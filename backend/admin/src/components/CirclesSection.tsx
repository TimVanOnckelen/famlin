import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, Circle, GroupMember } from '../api/client';
import { Icon } from './Icon';
import { avatarColor, initials } from '../avatar';

/**
 * Admin management for a group's Family Circles.
 *
 * Two things here are deliberate and easy to get wrong if this is ever
 * rewritten:
 *
 * 1. This is the ONLY surface that can enumerate a group's circles. The
 *    member-facing API returns just the caller's own circles, because a group
 *    member outside a circle must not learn it exists.
 *
 * 2. Management access is NOT content access. An admin who isn't in a circle
 *    cannot read its posts — not here, not in content moderation, not through
 *    a media URL. That's why deletion leans on the post COUNT rather than
 *    showing what's inside: the number is all an admin outside the circle is
 *    entitled to, and it's enough to make the destruction informed.
 */
export function CirclesSection({ groupId, members }: { groupId: string; members: GroupMember[] }) {
  const { t } = useTranslation();
  const [circles, setCircles] = useState<Circle[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [addUserId, setAddUserId] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true);
    try {
      setCircles(await api.getGroupCircles(groupId));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    setExpandedId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setBusy(true);
    try {
      await api.createCircle(groupId, { name: newName.trim(), description: newDescription.trim() || null });
      setNewName('');
      setNewDescription('');
      setCreating(false);
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(circle: Circle) {
    // The post count is the whole point of this confirmation: deleting a
    // circle permanently deletes its posts, and an admin outside the circle
    // has no way to look at what they're about to destroy.
    const message =
      circle.postCount > 0
        ? t('circles.confirmDeleteWithPosts', { name: circle.name, count: circle.postCount })
        : t('circles.confirmDelete', { name: circle.name });
    if (!confirm(message)) return;

    setBusy(true);
    try {
      await api.deleteCircle(circle.id, circle.postCount > 0);
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function handleAddMember(circleId: string) {
    if (!addUserId) return;
    setBusy(true);
    try {
      await api.addCircleMember(circleId, addUserId);
      setAddUserId('');
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function handleRemoveMember(circleId: string, userId: string) {
    setBusy(true);
    try {
      await api.removeCircleMember(circleId, userId);
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="md-section-header">
        <h4>{t('circles.heading', { count: circles.length })}</h4>
        {!creating && (
          <button type="button" className="link-button" onClick={() => setCreating(true)}>
            {t('circles.create')}
          </button>
        )}
      </div>

      <p className="md-hint">{t('circles.hint')}</p>

      {creating && (
        <form className="md-add-member" onSubmit={handleCreate}>
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder={t('circles.namePlaceholder')}
            maxLength={100}
            autoFocus
          />
          <input
            value={newDescription}
            onChange={(e) => setNewDescription(e.target.value)}
            placeholder={t('circles.descriptionPlaceholder')}
            maxLength={500}
          />
          <button type="submit" disabled={!newName.trim() || busy}>
            {t('common.save')}
          </button>
          <button type="button" className="secondary" onClick={() => setCreating(false)}>
            {t('common.cancel')}
          </button>
        </form>
      )}

      {loading ? (
        <div className="loading">{t('common.loading')}</div>
      ) : circles.length === 0 ? (
        <div className="empty">{t('circles.none')}</div>
      ) : (
        <ul className="member-cards">
          {circles.map((circle) => {
            const circleMemberIds = new Set((circle.members ?? []).map((m) => m.id));
            const candidates = members.filter((m) => !circleMemberIds.has(m.id));
            const expanded = expandedId === circle.id;

            return (
              <li key={circle.id} className="member-card md-circle-card">
                <div className="md-circle-row">
                  <span className="avatar" style={{ background: avatarColor(circle.name) }}>
                    {initials(circle.name)}
                  </span>
                  <span className="member-card-info">
                    <span className="member-card-name">{circle.name}</span>
                    <span className="member-card-sub">
                      {t('circles.memberCount', { count: circle.memberCount })} ·{' '}
                      {t('circles.postCount', { count: circle.postCount })}
                      {circle.description ? ` · ${circle.description}` : ''}
                    </span>
                  </span>
                  <button
                    className="icon-button"
                    title={t('circles.manageMembers')}
                    aria-label={t('circles.manageMembers')}
                    aria-expanded={expanded}
                    onClick={() => setExpandedId(expanded ? null : circle.id)}
                  >
                    <Icon name="users" size={14} />
                  </button>
                  <button
                    className="icon-button danger"
                    title={t('common.delete')}
                    aria-label={t('common.delete')}
                    onClick={() => handleDelete(circle)}
                    disabled={busy}
                  >
                    <Icon name="trash" size={14} />
                  </button>
                </div>

                {expanded && (
                  <div className="md-circle-members">
                    {(circle.members ?? []).length === 0 ? (
                      <div className="empty">{t('circles.noMembers')}</div>
                    ) : (
                      <ul className="membership-list">
                        {(circle.members ?? []).map((member) => (
                          <li key={member.id} className="membership-row">
                            <span>{member.name}</span>
                            <button
                              className="icon-button danger"
                              title={t('common.remove')}
                              aria-label={t('common.remove')}
                              onClick={() => handleRemoveMember(circle.id, member.id)}
                              disabled={busy}
                            >
                              <Icon name="x" size={14} />
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}

                    <div className="md-add-member">
                      <select
                        value={addUserId}
                        onChange={(e) => setAddUserId(e.target.value)}
                        disabled={candidates.length === 0}
                      >
                        {/* Only current group members can be offered: a circle
                            narrows the group, so it can never grant access to
                            someone the group itself excludes (the server
                            rejects it too). */}
                        <option value="">{t('circles.selectMember')}</option>
                        {candidates.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name} ({m.email})
                          </option>
                        ))}
                      </select>
                      <button type="button" onClick={() => handleAddMember(circle.id)} disabled={!addUserId || busy}>
                        {t('circles.addMember')}
                      </button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
