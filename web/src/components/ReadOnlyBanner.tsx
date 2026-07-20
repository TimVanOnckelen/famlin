import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { fetchServerInfo } from '@famlin/api-client';
import './ReadOnlyBanner.css';

export function ReadOnlyBanner() {
  const { t } = useTranslation();
  const { data: serverInfo } = useQuery({
    queryKey: ['server-info'],
    queryFn: fetchServerInfo,
  });

  if (!serverInfo?.readOnly) return null;

  return <div className="read-only-banner">{t('demo.readOnlyBanner')}</div>;
}
