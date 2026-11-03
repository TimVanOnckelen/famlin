import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import QRCode from 'qrcode'
import './ConnectAppQr.css'

interface ConnectAppQrProps {
  /** Defaults to this server's own /connect landing page. */
  url?: string
  appStoreUrl?: string | null
  playStoreUrl?: string | null
}

// QR code for the server's /connect landing page (issue #345): scanned with
// the phone's camera it opens the Famlin app pointed at this server. Rendered
// client-side only, so the address never leaves the page.
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
        <img className="connect-qr-image" src={dataUrl} alt={t('connectApp.qrAlt')} width={168} height={168} />
      )}
      <div className="connect-qr-text">
        <div className="profile-setting-desc">{t('connectApp.description')}</div>
        <div className="connect-qr-url">{target}</div>
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
