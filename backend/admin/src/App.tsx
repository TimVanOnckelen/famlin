import { useEffect, useState } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Layout } from './components/Layout';
import { LoginPage } from './components/LoginPage';
import { SetupPage } from './components/SetupPage';
import { DashboardPage } from './components/DashboardPage';
import { UsersPage } from './components/UsersPage';
import { GroupsPage } from './components/GroupsPage';
import { ContentPage } from './components/ContentPage';
import { ServerSettingsPage } from './components/ServerSettingsPage';
import { api, User } from './api/client';

function App() {
  const { t } = useTranslation();
  const [user, setUser] = useState<User | null>(null);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .getSetupStatus()
      .then(({ needsSetup }) => {
        if (needsSetup) {
          setNeedsSetup(true);
          setLoading(false);
          return;
        }

        const token = localStorage.getItem('famlin_admin_token');
        if (!token) {
          setLoading(false);
          return;
        }

        api
          .getMe()
          .then(setUser)
          .catch(() => localStorage.removeItem('famlin_admin_token'))
          .finally(() => setLoading(false));
      })
      .catch(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="loading">{t('common.loading')}</div>;
  }

  if (needsSetup) {
    return (
      <SetupPage
        onSetupComplete={(newUser) => {
          setNeedsSetup(false);
          setUser(newUser);
        }}
      />
    );
  }

  if (!user) {
    return <LoginPage onLogin={setUser} />;
  }

  if (!user.isAdmin) {
    return (
      <div className="error">
        <h2>{t('app.noAccessTitle')}</h2>
        <p>{t('app.noAccessMessage')}</p>
      </div>
    );
  }

  return (
    <Layout user={user}>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/users" element={<UsersPage />} />
        <Route path="/groups" element={<GroupsPage />} />
        <Route path="/content" element={<ContentPage />} />
        <Route path="/settings" element={<ServerSettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}

export default App;
