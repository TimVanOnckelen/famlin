import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError, MediaPerson, MediaPersonLink, User } from '../api/client';
import { Icon } from './Icon';

interface PeopleMappingSectionProps {
  users: User[];
}

export function PeopleMappingSection({ users }: PeopleMappingSectionProps) {
  const { t } = useTranslation();
  const [people, setPeople] = useState<MediaPerson[]>([]);
  const [peopleLinks, setPeopleLinks] = useState<MediaPersonLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Form state for adding/editing a mapping
  const [selectedPerson, setSelectedPerson] = useState<MediaPerson | null>(null);
  const [personLabel, setPersonLabel] = useState('');
  const [selectedUserId, setSelectedUserId] = useState<string>('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [peopleRes, linksRes] = await Promise.all([
        api.getMediaPeople('immich').catch((err) => {
          if (err instanceof ApiError && err.code === 'not_configured') {
            return []; // Provider not configured
          }
          throw err;
        }),
        api.getMediaPersonLinks(),
      ]);
      setPeople(peopleRes || []);
      setPeopleLinks(linksRes);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : t('common.error');
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectPerson = (person: MediaPerson) => {
    setSelectedPerson(person);
    // Prefill label with person's name if not already mapped
    const existing = peopleLinks.find((l) => l.externalPersonId === person.id && l.provider === 'immich');
    if (existing) {
      setPersonLabel(existing.label);
      setSelectedUserId(existing.user?.id || '');
    } else {
      setPersonLabel(person.name);
      setSelectedUserId('');
    }
  };

  const handleSaveMapping = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPerson || !personLabel.trim()) return;

    setSaving(true);
    try {
      await api.createMediaPersonLink({
        provider: 'immich',
        externalPersonId: selectedPerson.id,
        label: personLabel.trim(),
        userId: selectedUserId || undefined,
      });
      await loadData();
      setSelectedPerson(null);
      setPersonLabel('');
      setSelectedUserId('');
    } catch (err) {
      const message = err instanceof ApiError ? err.message : t('common.error');
      alert(t('media.peopleMapping.saveError', { error: message }));
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveMapping = async (link: MediaPersonLink) => {
    if (!confirm(t('media.peopleMapping.removeConfirm', { name: link.label }))) return;

    try {
      await api.deleteMediaPersonLink(link.id);
      await loadData();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : t('common.error');
      alert(t('media.peopleMapping.removeError', { error: message }));
    }
  };

  const mappedPersonIds = new Set(peopleLinks.map((l) => l.externalPersonId));
  const unmappedPeople = people.filter((p) => !mappedPersonIds.has(p.id));

  if (loading) return <div className="loading">{t('common.loading')}</div>;

  if (error && people.length === 0) {
    return (
      <div>
        <h4 style={{ marginTop: '1.5rem' }}>{t('media.peopleMapping.title')}</h4>
        <p className="hint">{t('media.peopleMapping.hint')}</p>
        {error === 'not_configured' ? (
          <p className="hint">{t('media.peopleMapping.notConfigured')}</p>
        ) : (
          <div className="error">{error}</div>
        )}
      </div>
    );
  }

  return (
    <div>
      <h4 style={{ marginTop: '1.5rem' }}>{t('media.peopleMapping.title')}</h4>
      <p className="hint">{t('media.peopleMapping.hint')}</p>

      {/* Mapped people */}
      {peopleLinks.length > 0 && (
        <>
          <h5 style={{ marginTop: '1rem', marginBottom: '0.5rem' }}>
            {t('media.peopleMapping.mapped')}
            <span className="badge" style={{ marginLeft: '0.5rem' }}>
              {peopleLinks.length}
            </span>
          </h5>
          <ul className="member-cards">
            {peopleLinks.map((link) => {
              const person = people.find((p) => p.id === link.externalPersonId);
              return (
                <li key={link.id} className="member-card">
                  {person?.thumbnailDataUri && (
                    <img
                      src={person.thumbnailDataUri}
                      alt={link.label}
                      style={{
                        width: '40px',
                        height: '40px',
                        borderRadius: 'var(--r-sm)',
                        objectFit: 'cover',
                      }}
                    />
                  )}
                  <span className="member-card-info">
                    <span className="member-card-name">
                      {link.label}
                      {link.user && <span className="badge" style={{ marginLeft: '0.5rem' }}>{link.user.name}</span>}
                    </span>
                    {link.user && (
                      <span className="member-card-sub">{link.user.email}</span>
                    )}
                  </span>
                  <button
                    className="icon-button danger"
                    title={t('common.remove')}
                    aria-label={t('common.remove')}
                    onClick={() => handleRemoveMapping(link)}
                  >
                    <Icon name="x" size={14} />
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {/* Unmapped people picker */}
      {unmappedPeople.length > 0 && (
        <>
          <h5 style={{ marginTop: '1rem', marginBottom: '0.5rem' }}>
            {t('media.peopleMapping.unmapped')}
            <span className="badge" style={{ marginLeft: '0.5rem' }}>
              {unmappedPeople.length}
            </span>
          </h5>

          {selectedPerson ? (
            <form onSubmit={handleSaveMapping} style={{ marginBottom: '1rem' }}>
              <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-start', marginBottom: '1rem' }}>
                {selectedPerson.thumbnailDataUri && (
                  <img
                    src={selectedPerson.thumbnailDataUri}
                    alt={selectedPerson.name}
                    style={{
                      width: '80px',
                      height: '80px',
                      borderRadius: 'var(--r-md)',
                      objectFit: 'cover',
                    }}
                  />
                )}
                <div style={{ flex: 1 }}>
                  <label>
                    {t('media.peopleMapping.displayName')}
                    <input
                      type="text"
                      value={personLabel}
                      onChange={(e) => setPersonLabel(e.target.value)}
                      required
                      autoFocus
                    />
                  </label>
                  <label>
                    {t('media.peopleMapping.familyMember')}
                    <select value={selectedUserId} onChange={(e) => setSelectedUserId(e.target.value)}>
                      <option value="">{t('media.peopleMapping.selectUser')}</option>
                      {users.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name} ({u.email})
                        </option>
                      ))}
                    </select>
                  </label>
                  <p className="hint">{t('media.peopleMapping.userMappingHint')}</p>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button type="submit" disabled={saving || !personLabel.trim()}>
                      {saving ? t('common.loading') : t('common.save')}
                    </button>
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => setSelectedPerson(null)}
                      disabled={saving}
                    >
                      {t('common.cancel')}
                    </button>
                  </div>
                </div>
              </div>
            </form>
          ) : (
            <ul className="member-cards">
              {unmappedPeople.map((person) => (
                <li
                  key={person.id}
                  className="member-card"
                  onClick={() => handleSelectPerson(person)}
                  style={{ cursor: 'pointer' }}
                >
                  {person.thumbnailDataUri && (
                    <img
                      src={person.thumbnailDataUri}
                      alt={person.name}
                      style={{
                        width: '40px',
                        height: '40px',
                        borderRadius: 'var(--r-sm)',
                        objectFit: 'cover',
                      }}
                    />
                  )}
                  <span className="member-card-info">
                    <span className="member-card-name">{person.name}</span>
                  </span>
                  <Icon name="chevron-right" size={16} />
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {people.length === 0 && peopleLinks.length === 0 && (
        <div className="empty" style={{ marginTop: '1rem' }}>{t('media.peopleMapping.noPeople')}</div>
      )}
    </div>
  );
}
