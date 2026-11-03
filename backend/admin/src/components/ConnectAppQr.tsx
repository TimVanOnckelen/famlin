import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import QRCode from 'qrcode'

interface ConnectAppQrProps {
  /** Defaults to this server's own /connect landing page. */
  url?: string
  appStoreUrl?: string | null
  playStoreUrl?: string | null
}

// Renders a QR code for the server's /connect landing page (issue #345).
// Generated entirely in the browser — the address never leaves the page.
// Reusable: the dashboard card uses it today, a setup wizard can drop it in.
export function ConnectAppQr({ url, appStoreUrl, playStoreUrl }: ConnectAppQrProps) {
  const { t } = useTranslation()
  const target = url ?? `${window.location.origin}/connect`
  const [dataUrl, setDataUrl] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    QRCode.toDataURL(target, { margin: 1, width: 360, errorCorrectionLevel: 'M' })
      .then((result) => {
        if (!cancelled) setDataUrl(result)
      })
      .catch(() => {
        if (!cancelled) setDataUrl(null)
      })
    return () => {
      cancelled = true
    }
  }, [target])

  return (
    <div className="connect-qr">
      {dataUrl && (
        <img className="connect-qr-image" src={dataUrl} alt={t('connectApp.qrAlt')} width={180} height={180} />
      )}
      <div className="connect-qr-text">
        <p className="hint" style={{ marginTop: 0 }}>
          {t('connectApp.description')}
        </p>
        <code className="connect-qr-url">{target}</code>
        {(appStoreUrl || playStoreUrl) && (
          <div className="connect-qr-stores">
            {appStoreUrl && (
              <a href={appStoreUrl} target="_blank" rel="noreferrer">
                {t('connectApp.appStore')}
              </a>
            )}
            {playStoreUrl && (
              <a href={playStoreUrl} target="_blank" rel="noreferrer">
                {t('connectApp.playStore')}
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
