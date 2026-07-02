import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Logo } from './Logo';
import { User } from '../types';
import i18n, { SUPPORTED_LANGUAGES, SupportedLanguage, storeLanguage } from '../i18n';

interface LayoutProps {
  user: User;
  children: React.ReactNode;
}

export function Layout({ user, children }: LayoutProps) {
  const { t, i18n: i18nInstance } = useTranslation();

  const handleLogout = () => {
    localStorage.removeItem('famlin_admin_token');
    window.location.href = '/admin';
  };

  const handleLanguageChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const lang = e.target.value as SupportedLanguage;
    i18n.changeLanguage(lang);
    storeLanguage(lang);
  };

  return (
    <div className="app-layout">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <Logo size={40} />
          <h1>{t('common.appName')}</h1>
        </div>
        <nav>
          <NavLink to="/" end>
            {t('layout.dashboard')}
          </NavLink>
          <NavLink to="/users">{t('layout.users')}</NavLink>
          <NavLink to="/groups">{t('layout.groups')}</NavLink>
          <NavLink to="/content">{t('layout.content')}</NavLink>
          <NavLink to="/settings">{t('layout.serverSettings')}</NavLink>
        </nav>
        <div className="user">
          <div>{user.name}</div>
          <div style={{ fontSize: '0.75rem' }}>{user.email}</div>
          <label style={{ marginTop: '0.75rem', fontSize: '0.75rem' }}>
            {t('layout.language')}
            <select
              value={i18nInstance.language}
              onChange={handleLanguageChange}
              style={{ marginLeft: '0.5rem' }}
            >
              {SUPPORTED_LANGUAGES.map((lang) => (
                <option key={lang} value={lang}>
                  {lang === 'en' ? 'English' : 'Nederlands'}
                </option>
              ))}
            </select>
          </label>
          <button className="secondary" onClick={handleLogout}>
            {t('layout.logout')}
          </button>
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
