import { FormEvent, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  uploadFiles,
  changePassword,
  deleteAccount,
  fetchNotificationConfig,
  fetchServerInfo,
  updateMe,
  NotificationPrefs,
  User,
} from '@famlin/api-client';
import { Icon } from '@/components/Icon';
import { Avatar } from '@/components/Avatar';
import { BottomNav } from '@/components/BottomNav';
import { useAuthStore } from '@/stores/authStore';
import { SUPPORTED_LANGUAGES, SupportedLanguage, storeLanguage } from '@/i18n';
import './ProfilePage.css';

// Web counterpart of mobile's ProfileScreen: same sections (profile card,
// notification prefs, language, server info, logout), desktop-styled. The
// server URL is the page's own origin — the web app is same-origin with the
// backend, unlike mobile where the user typed it at login.
export function ProfilePage({
  user,
  onBack,
  onOpenPhotos,
  onOpenChat,
  onLogout,
}: {
  user: User;
  onBack: () => void;
  onOpenPhotos?: () => void;
  onOpenChat?: () => void;
  onLogout: () => void;
}) {
  const { t, i18n: i18nInstance } = useTranslation();
  const { updateUser } = useAuthStore();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSuccess, setPasswordSuccess] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const { data: notificationConfig } = useQuery({
    queryKey: ['notification-config'],
    queryFn: fetchNotificationConfig,
  });
  const showPush = notificationConfig?.pushEnabled ?? true;
  const showEmail = notificationConfig?.emailEnabled ?? true;

  const { data: serverInfo } = useQuery({
    queryKey: ['server-info'],
    queryFn: fetchServerInfo,
  });

  const updatePrefs = useMutation({
    mutationFn: (prefs: NotificationPrefs) => updateMe(prefs),
    onSuccess: (updated) => updateUser(updated),
  });

  const updateAvatar = useMutation({
    mutationFn: async (file: File) => {
      const urls = await uploadFiles([file]);
      return updateMe({ avatarUrl: urls[0] });
    },
    onSuccess: (updated) => {
      setUploadError(null);
      updateUser(updated);
    },
    onError: (err: any) => {
      setUploadError(err.response?.data?.error || t('profile.photoUploadFailed'));
    },
  });

  const updatePassword = useMutation({
    mutationFn: () => changePassword(currentPassword, newPassword),
    onSuccess: () => {
      setPasswordError(null);
      setPasswordSuccess(true);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    },
    onError: (err: any) => {
      setPasswordSuccess(false);
      setPasswordError(err.response?.data?.error || t('profile.passwordChangeFailed'));
    },
  });

  // Permanent, cascading account deletion (DELETE /api/auth/me) — mirrors
  // mobile's ProfileScreen, including the type-to-confirm step, since nothing
  // it removes can be restored.
  const removeAccount = useMutation({
    mutationFn: deleteAccount,
    onSuccess: () => {
      setDeleteOpen(false);
      onLogout();
    },
    onError: (err: any) => {
      setDeleteError(err.response?.data?.error || t('common.tryAgain'));
    },
  });

  const deleteConfirmWord = t('profile.deleteAccountConfirmWord');
  const canConfirmDelete =
    deleteConfirmation.trim().toUpperCase() === deleteConfirmWord.toUpperCase() && !removeAccount.isPending;

  function handlePasswordSubmit(e: FormEvent) {
    e.preventDefault();
    setPasswordSuccess(false);
    if (newPassword !== confirmPassword) {
      setPasswordError(t('profile.passwordMismatch'));
      return;
    }
    setPasswordError(null);
    updatePassword.mutate();
  }

  function pickAvatar(files: FileList | null) {
    const file = files?.[0];
    if (file) updateAvatar.mutate(file);
    // Allow re-picking the same file after a failure.
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  const notificationTypes: {
    labelKey: string;
    pushKey: keyof NotificationPrefs;
    emailKey: keyof NotificationPrefs;
  }[] = [
    { labelKey: 'profile.notifyNewPost', pushKey: 'pushOnNewPost', emailKey: 'emailOnNewPost' },
    { labelKey: 'profile.notifyNewComment', pushKey: 'pushOnNewComment', emailKey: 'emailOnNewComment' },
    { labelKey: 'profile.notifyNewLike', pushKey: 'pushOnNewLike', emailKey: 'emailOnNewLike' },
  ];

  function handleLanguageChange(lang: SupportedLanguage) {
    i18nInstance.changeLanguage(lang);
    storeLanguage(lang);
  }

  return (
    <div className="profile-shell">
      <main className="profile-column">
        <button className="profile-back" onClick={onBack}>
          <Icon name="chevron-left" size={16} strokeWidth={2.5} />
          {t('profile.backToFeed')}
        </button>

        <h1 className="profile-title">{t('profile.title')}</h1>

        <section className="profile-card">
          <button
            className="profile-avatar-button"
            onClick={() => fileInputRef.current?.click()}
            disabled={updateAvatar.isPending}
            aria-label={t('profile.changePhoto')}
          >
            <Avatar name={user.name} avatarUrl={user.avatarUrl} size={88} />
            <span className="profile-avatar-badge" aria-hidden>
              <Icon name="camera" size={14} color="white" strokeWidth={2} />
            </span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => pickAvatar(e.target.files)}
          />
          <div className="profile-name">{user.name}</div>
          <div className="profile-email">{user.email}</div>
          {user.isAdmin && <span className="profile-admin-badge">{t('profile.adminBadge')}</span>}
          {uploadError && (
            <div className="profile-error" role="alert">
              {uploadError}
            </div>
          )}
        </section>

        {(showPush || showEmail) && (
          <section className="profile-section">
            <h2 className="profile-section-title">{t('profile.notifications')}</h2>
            <div className="profile-notification-header">
              <span className="profile-notification-spacer" />
              {showPush && <span className="profile-notification-col">{t('profile.push')}</span>}
              {showEmail && <span className="profile-notification-col">{t('profile.email')}</span>}
            </div>
            {notificationTypes.map(({ labelKey, pushKey, emailKey }) => (
              <div key={labelKey} className="profile-notification-row">
                <span className="profile-setting-label profile-notification-label">{t(labelKey)}</span>
                {showPush && (
                  <span className="profile-notification-col">
                    <input
                      type="checkbox"
                      role="switch"
                      className="profile-toggle"
                      checked={user[pushKey] ?? false}
                      onChange={(e) => updatePrefs.mutate({ [pushKey]: e.target.checked })}
                      aria-label={`${t(labelKey)} — ${t('profile.push')}`}
                    />
                  </span>
                )}
                {showEmail && (
                  <span className="profile-notification-col">
                    <input
                      type="checkbox"
                      role="switch"
                      className="profile-toggle"
                      checked={user[emailKey] ?? false}
                      onChange={(e) => updatePrefs.mutate({ [emailKey]: e.target.checked })}
                      aria-label={`${t(labelKey)} — ${t('profile.email')}`}
                    />
                  </span>
                )}
              </div>
            ))}
          </section>
        )}

        <section className="profile-section">
          <h2 className="profile-section-title">{t('profile.settings')}</h2>
          <div className="profile-setting-row">
            <div>
              <div className="profile-setting-label">{t('profile.language')}</div>
              <div className="profile-setting-desc">{t('profile.languageDescription')}</div>
            </div>
            <select
              className="profile-language-select"
              value={i18nInstance.language as SupportedLanguage}
              onChange={(e) => handleLanguageChange(e.target.value as SupportedLanguage)}
              aria-label={t('profile.language')}
            >
              {SUPPORTED_LANGUAGES.map((lang) => (
                <option key={lang} value={lang}>
                  {t(`profile.languages.${lang}`)}
                </option>
              ))}
            </select>
          </div>
        </section>

        {user.hasPassword && (
          <section className="profile-section">
            <h2 className="profile-section-title">{t('profile.security')}</h2>
            <form className="profile-password-form" onSubmit={handlePasswordSubmit}>
              <label className="field">
                <span className="field-label">{t('profile.currentPassword')}</span>
                <input
                  className="field-input"
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                />
              </label>
              <label className="field">
                <span className="field-label">{t('profile.newPassword')}</span>
                <input
                  className="field-input"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  autoComplete="new-password"
                  minLength={8}
                  required
                />
              </label>
              <label className="field">
                <span className="field-label">{t('profile.confirmPassword')}</span>
                <input
                  className="field-input"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  autoComplete="new-password"
                  minLength={8}
                  required
                />
              </label>
              {passwordError && (
                <div className="profile-error" role="alert">
                  {passwordError}
                </div>
              )}
              {passwordSuccess && (
                <div className="profile-password-success" role="status">
                  {t('profile.passwordChanged')}
                </div>
              )}
              <button className="btn btn-primary" type="submit" disabled={updatePassword.isPending}>
                {updatePassword.isPending ? t('common.loading') : t('profile.changePassword')}
              </button>
            </form>
          </section>
        )}

        <section className="profile-section">
          <h2 className="profile-section-title">{t('profile.server')}</h2>
          <div className="profile-server-row">
            <span className="profile-server-icon" aria-hidden>
              <Icon name="server" size={18} color="white" />
            </span>
            <div className="profile-server-text">
              <div className="profile-setting-desc">{t('profile.connectedTo')}</div>
              <div className="profile-server-url">{window.location.origin}</div>
              {serverInfo?.version && (
                <div className="profile-setting-desc">
                  {t('profile.serverVersion', { version: serverInfo.version })}
                </div>
              )}
            </div>
          </div>
        </section>

        <button className="btn btn-primary profile-logout" onClick={onLogout}>
          {t('common.logout')}
        </button>

        <section className="profile-section profile-danger">
          <h2 className="profile-section-title">{t('profile.dangerZone')}</h2>
          <p className="profile-setting-desc">{t('profile.deleteAccountDescription')}</p>

          {!deleteOpen ? (
            <button
              className="profile-delete-trigger"
              onClick={() => {
                setDeleteConfirmation('');
                setDeleteError(null);
                setDeleteOpen(true);
              }}
            >
              <Icon name="trash" size={16} />
              {t('profile.deleteAccount')}
            </button>
          ) : (
            <form
              className="profile-delete-form"
              onSubmit={(e) => {
                e.preventDefault();
                setDeleteError(null);
                removeAccount.mutate();
              }}
            >
              <p className="profile-delete-warning">{t('profile.deleteAccountWarning')}</p>
              <label className="field">
                <span className="field-label">
                  {t('profile.deleteAccountConfirmPrompt', { word: deleteConfirmWord })}
                </span>
                <input
                  className="field-input"
                  type="text"
                  value={deleteConfirmation}
                  onChange={(e) => setDeleteConfirmation(e.target.value)}
                  placeholder={deleteConfirmWord}
                  autoComplete="off"
                />
              </label>
              {deleteError && (
                <div className="profile-error" role="alert">
                  {deleteError}
                </div>
              )}
              <div className="profile-delete-actions">
                <button type="submit" className="profile-delete-confirm" disabled={!canConfirmDelete}>
                  {removeAccount.isPending ? t('common.loading') : t('profile.deleteAccountConfirm')}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setDeleteOpen(false)}
                  disabled={removeAccount.isPending}
                >
                  {t('common.cancel')}
                </button>
              </div>
            </form>
          )}
        </section>
      </main>

      <BottomNav active="profile" onFeed={onBack} onPhotos={onOpenPhotos} onChat={onOpenChat} onProfile={() => {}} />
    </div>
  );
}
