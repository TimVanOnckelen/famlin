import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { setStorageAdapter, setApiBaseUrl } from '@famlin/api-client';
import { adminLocalStorageAdapter } from './storageAdapter';
import './i18n';
import App from './App';
import './index.css';

// Required once at startup for the shared package's browser OIDC helpers
// (used by LoginPage) — see storageAdapter.ts. Admin is always served
// same-origin with the backend (in dev, Vite proxies /api to it — see
// vite.config.ts), same as web/'s equivalent setup in web/src/main.tsx.
setStorageAdapter(adminLocalStorageAdapter);
setApiBaseUrl(window.location.origin);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter basename="/admin">
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
