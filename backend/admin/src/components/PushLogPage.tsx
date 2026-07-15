import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, PushDeliveryLog } from '../api/client';
import i18n from '../i18n';

function truncate(text: string | null, length = 60) {
  if (!text) return '';
  return text.length > length ? `${text.slice(0, length)}…` : text;
}

function DateCell({ iso }: { iso: string }) {
  const date = new Date(iso);
  return (
    <span className="muted" title={date.toLocaleString(i18n.language)}>
      {date.toLocaleString(i18n.language)}
    </span>
  );
}

export function PushLogPage() {
  const { t } = useTranslation();
  const [logs, setLogs] = useState<PushDeliveryLog[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const requestIdRef = useRef(0);

  const load = async () => {
    const requestId = ++requestIdRef.current;
    try {
      const page = await api.getPushLog();
      if (requestId !== requestIdRef.current) return;
      setLogs(page.items);
      setNextCursor(page.nextCursor);
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const loadMore = async () => {
    if (!nextCursor) return;
    const requestId = requestIdRef.current;
    setLoadingMore(true);
    try {
      const page = await api.getPushLog({ cursor: nextCursor });
      if (requestId !== requestIdRef.current) return;
      setLogs((current) => [...current, ...page.items]);
      setNextCursor(page.nextCursor);
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <>
      <div className="page-header">
        <h2>{t('pushLog.title')}</h2>
      </div>

      <div className="card">
        {loading ? (
          <div className="loading">{t('common.loading')}</div>
        ) : logs.length === 0 ? (
          <div className="empty">{t('pushLog.noLogs')}</div>
        ) : (
          <div className="content-table">
            <table>
              <thead>
                <tr>
                  <th>{t('pushLog.table.date')}</th>
                  <th>{t('pushLog.table.type')}</th>
                  <th>{t('pushLog.table.post')}</th>
                  <th>{t('pushLog.table.recipients')}</th>
                  <th>{t('pushLog.table.delivered')}</th>
                  <th>{t('pushLog.table.failed')}</th>
                  <th>{t('pushLog.table.triggeredBy')}</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id}>
                    <td>
                      <DateCell iso={log.createdAt} />
                    </td>
                    <td>{t(`pushLog.types.${log.notifyType}`, log.notifyType)}</td>
                    <td className="cell-content">
                      {log.post ? (
                        <>
                          {log.post.content ? (
                            truncate(log.post.content)
                          ) : (
                            <span className="muted">{t('content.noText')}</span>
                          )}
                          <span className="cell-sub"> — {log.post.group.name}</span>
                        </>
                      ) : (
                        <span className="muted">{t('pushLog.noPost')}</span>
                      )}
                    </td>
                    <td>{log.recipientCount}</td>
                    <td>{log.successCount}</td>
                    <td>{log.failureCount > 0 ? log.failureCount : <span className="muted">0</span>}</td>
                    <td>
                      {log.triggeredByAdmin ? (
                        log.triggeredByAdmin.name
                      ) : (
                        <span className="muted">{t('pushLog.system')}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!loading && nextCursor && (
          <div className="load-more">
            <button className="secondary" disabled={loadingMore} onClick={loadMore}>
              {loadingMore ? t('common.loading') : t('common.loadMore')}
            </button>
          </div>
        )}
      </div>
    </>
  );
}
