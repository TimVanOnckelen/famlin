import { FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createApiToken, fetchApiTokens, revokeApiToken, CreatedApiToken } from '@famlin/api-client';
import './ApiTokensModal.css';

// Developer personal access tokens — deliberately a web-only surface (the
// mobile app has no equivalent screen): creating credentials is a
// sit-down-at-a-desk task, and the API reference this pairs with lives on
// the docs site.
export function ApiTokensModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [expiresInDays, setExpiresInDays] = useState<number | undefined>(undefined);
  // The secret of the token created in this modal session — the only time
  // it's ever visible, so it stays on screen until the modal closes.
  const [createdToken, setCreatedToken] = useState<CreatedApiToken | null>(null);
  const [copied, setCopied] = useState(false);

  const tokensQuery = useQuery({ queryKey: ['api-tokens'], queryFn: fetchApiTokens });

  const createMutation = useMutation({
    mutationFn: () => createApiToken({ name: name.trim(), expiresInDays }),
    onSuccess: (token) => {
      setCreatedToken(token);
      setCopied(false);
      setName('');
      queryClient.invalidateQueries({ queryKey: ['api-tokens'] });
    },
  });

  const revokeMutation = useMutation({
    mutationFn: (id: string) => revokeApiToken(id),
    onSuccess: (_data, id) => {
      if (createdToken?.id === id) setCreatedToken(null);
      queryClient.invalidateQueries({ queryKey: ['api-tokens'] });
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    if (name.trim() && !createMutation.isPending) createMutation.mutate();
  }

  async function copyToken() {
    if (!createdToken) return;
    await navigator.clipboard.writeText(createdToken.token);
    setCopied(true);
  }

  const tokens = tokensQuery.data ?? [];
  const formatDate = (value: string) => new Date(value).toLocaleDateString();

  return (
    <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal>
      <div className="modal-card api-tokens-card" onClick={(e) => e.stopPropagation()}>
        <h2 className="modal-title">{t('apiTokens.title')}</h2>
        <p className="api-tokens-intro">
          {t('apiTokens.intro')}{' '}
          <a href="https://famlin.app/docs/developers/api" target="_blank" rel="noreferrer">
            {t('apiTokens.docsLink')}
          </a>
        </p>

        {createdToken && (
          <div className="api-token-created" role="status">
            <div className="api-token-created-heading">{t('apiTokens.createdHeading', { name: createdToken.name })}</div>
            <div className="api-token-created-warning">{t('apiTokens.shownOnce')}</div>
            <div className="api-token-secret-row">
              <code className="api-token-secret">{createdToken.token}</code>
              <button type="button" className="btn btn-secondary" onClick={copyToken}>
                {copied ? t('apiTokens.copied') : t('apiTokens.copy')}
              </button>
            </div>
          </div>
        )}

        <form className="api-token-form" onSubmit={submit}>
          <label className="field api-token-name-field">
            <span className="field-label">{t('apiTokens.nameLabel')}</span>
            <input
              className="field-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('apiTokens.namePlaceholder')}
              maxLength={100}
            />
          </label>
          <label className="field">
            <span className="field-label">{t('apiTokens.expiryLabel')}</span>
            <select
              className="field-input"
              value={expiresInDays ?? ''}
              onChange={(e) => setExpiresInDays(e.target.value ? Number(e.target.value) : undefined)}
            >
              <option value="">{t('apiTokens.expiryNever')}</option>
              <option value="30">{t('apiTokens.expiryDays', { count: 30 })}</option>
              <option value="90">{t('apiTokens.expiryDays', { count: 90 })}</option>
              <option value="365">{t('apiTokens.expiryDays', { count: 365 })}</option>
            </select>
          </label>
          <button type="submit" className="btn btn-primary" disabled={!name.trim() || createMutation.isPending}>
            {createMutation.isPending ? t('common.loading') : t('apiTokens.create')}
          </button>
        </form>
        {createMutation.isError && <div className="modal-error">{t('apiTokens.createFailed')}</div>}

        {tokensQuery.isLoading && <div className="api-tokens-hint">{t('common.loading')}</div>}
        {tokensQuery.isError && <div className="api-tokens-hint">{t('apiTokens.loadFailed')}</div>}
        {tokensQuery.isSuccess && tokens.length === 0 && (
          <div className="api-tokens-hint">{t('apiTokens.empty')}</div>
        )}

        {tokens.length > 0 && (
          <ul className="api-token-list">
            {tokens.map((token) => (
              <li key={token.id} className="api-token-item">
                <div className="api-token-item-main">
                  <span className="api-token-item-name">{token.name}</span>
                  <code className="api-token-item-preview">famlin_pat_{token.tokenPreview}…</code>
                </div>
                <div className="api-token-item-meta">
                  <span>{t('apiTokens.created', { date: formatDate(token.createdAt) })}</span>
                  <span>
                    {token.lastUsedAt
                      ? t('apiTokens.lastUsed', { date: formatDate(token.lastUsedAt) })
                      : t('apiTokens.neverUsed')}
                  </span>
                  {token.expiresAt && <span>{t('apiTokens.expires', { date: formatDate(token.expiresAt) })}</span>}
                </div>
                <button
                  type="button"
                  className="btn btn-secondary api-token-revoke"
                  onClick={() => {
                    if (window.confirm(t('apiTokens.revokeConfirm', { name: token.name }))) {
                      revokeMutation.mutate(token.id);
                    }
                  }}
                  disabled={revokeMutation.isPending}
                >
                  {t('apiTokens.revoke')}
                </button>
              </li>
            ))}
          </ul>
        )}
        {revokeMutation.isError && <div className="modal-error">{t('apiTokens.revokeFailed')}</div>}

        <div className="modal-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            {t('common.close')}
          </button>
        </div>
      </div>
    </div>
  );
}
