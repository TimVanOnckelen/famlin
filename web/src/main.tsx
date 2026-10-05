import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { setStorageAdapter, setApiBaseUrl, setLanguageResolver } from '@famlin/api-client';
import { webLocalStorageAdapter } from './storageAdapter';
import App from './App';
import i18n from './i18n';
import './index.css';

setStorageAdapter(webLocalStorageAdapter);
// Same-origin — the Vite dev server proxies /api to the backend (see
// vite.config.ts); a production build is served behind the same reverse
// proxy as the backend, so this holds there too.
setApiBaseUrl(window.location.origin);
// Backend error messages follow the UI language, not the browser's own
// Accept-Language (which ignores the in-app language picker).
setLanguageResolver(() => i18n.resolvedLanguage ?? i18n.language);

const queryClient = new QueryClient();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>
);
