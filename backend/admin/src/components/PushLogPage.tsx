import { InitialAvatar } from './common/InitialAvatar'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api, PushDeliveryLog } from '../api/client'
import i18n from '../i18n'
import { PageHeader } from '@famlin/ui/common/page-header'
import { StateMessage } from '@famlin/ui/common/state-message'
import { Button } from '@famlin/ui/button'
import { Card, CardContent } from '@famlin/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@famlin/ui/table'

function truncate(text: string | null, length = 60) {
  if (!text) return ''
  return text.length > length ? `${text.slice(0, length)}…` : text
}

function DateCell({ iso }: { iso: string }) {
  const date = new Date(iso)
  return (
    <span className="text-sm text-muted-foreground" title={date.toLocaleString(i18n.language)}>
      {date.toLocaleString(i18n.language)}
    </span>
  )
}

export function PushLogPage() {
  const { t } = useTranslation()
  const [logs, setLogs] = useState<PushDeliveryLog[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const requestIdRef = useRef(0)

  const load = async () => {
    const requestId = ++requestIdRef.current
    try {
      const page = await api.getPushLog()
      if (requestId !== requestIdRef.current) return
      setLogs(page.items)
      setNextCursor(page.nextCursor)
    } finally {
      if (requestId === requestIdRef.current) setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const loadMore = async () => {
    if (!nextCursor) return
    const requestId = requestIdRef.current
    setLoadingMore(true)
    try {
      const page = await api.getPushLog({ cursor: nextCursor })
      if (requestId !== requestIdRef.current) return
      setLogs((current) => [...current, ...page.items])
      setNextCursor(page.nextCursor)
    } finally {
      setLoadingMore(false)
    }
  }

  return (
    <>
      <PageHeader title={t('pushLog.title')} />
      <Card className="py-0 shadow-sm">
        <CardContent className="px-0">
          {loading ? (
            <StateMessage variant="loading">{t('common.loading')}</StateMessage>
          ) : logs.length === 0 ? (
            <StateMessage>{t('pushLog.noLogs')}</StateMessage>
          ) : (
            <Table stacked>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('pushLog.table.date')}</TableHead>
                  <TableHead>{t('pushLog.table.type')}</TableHead>
                  <TableHead>{t('pushLog.table.post')}</TableHead>
                  <TableHead>{t('pushLog.table.recipients')}</TableHead>
                  <TableHead>{t('pushLog.table.delivered')}</TableHead>
                  <TableHead>{t('pushLog.table.failed')}</TableHead>
                  <TableHead>{t('pushLog.table.triggeredBy')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell>
                      <DateCell iso={log.createdAt} />
                    </TableCell>
                    <TableCell label={t('pushLog.table.type')}>
                      {t(`pushLog.types.${log.notifyType}`, log.notifyType)}
                    </TableCell>
                    <TableCell label={t('pushLog.table.post')} className="max-w-80 whitespace-normal">
                      {log.post ? (
                        <>
                          {log.post.content ? (
                            truncate(log.post.content)
                          ) : (
                            <span className="text-muted-foreground">{t('content.noText')}</span>
                          )}
                          <span className="text-xs text-muted-foreground"> — {log.post.group.name}</span>
                        </>
                      ) : (
                        <span className="text-muted-foreground">{t('pushLog.noPost')}</span>
                      )}
                    </TableCell>
                    <TableCell label={t('pushLog.table.recipients')}>{log.recipientCount}</TableCell>
                    <TableCell label={t('pushLog.table.delivered')}>{log.successCount}</TableCell>
                    <TableCell label={t('pushLog.table.failed')}>
                      {log.failureCount > 0 ? log.failureCount : <span className="text-muted-foreground">0</span>}
                    </TableCell>
                    <TableCell label={t('pushLog.table.triggeredBy')}>
                      {log.triggeredByAdmin ? (
                        <span className="inline-flex items-center gap-2">
                          <InitialAvatar
                            name={log.triggeredByAdmin.name}
                            avatarUrl={log.triggeredByAdmin.avatarUrl}
                            className="size-8"
                          />
                          {log.triggeredByAdmin.name}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">{t('pushLog.system')}</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {!loading && nextCursor && (
            <div className="flex justify-center p-4">
              <Button variant="secondary" disabled={loadingMore} onClick={loadMore}>
                {loadingMore ? t('common.loading') : t('common.loadMore')}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  )
}
