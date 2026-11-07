import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useModalFocus } from '@/hooks/useModalFocus'
import { getAvatarCrop, prepareAvatar } from '@/utils/avatar-image'
import { convertAvatarForPreview, isHeicImage } from '@/utils/avatar-conversion'
import './AvatarCropModal.css'

export function AvatarCropModal({
  file,
  onClose,
  onSave,
}: {
  file: File
  onClose: () => void
  onSave: (file: File) => void
}) {
  const { t } = useTranslation()
  const cardRef = useRef<HTMLDivElement>(null)
  const imageRef = useRef<HTMLImageElement>(null)
  const active = useRef(true)
  const conversion = useRef<AbortController | null>(null)
  const conversionAttempted = useRef(false)
  const drag = useRef<{ x: number; y: number; cropX: number; cropY: number } | null>(null)
  const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null)
  const [crop, setCrop] = useState({ zoom: 1, x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const [busy, setBusy] = useState(false)
  const [converting, setConverting] = useState(false)
  const [error, setError] = useState(false)
  useModalFocus(cardRef, onClose)

  useEffect(() => {
    active.current = true
    conversion.current = new AbortController()
    conversionAttempted.current = false
    const url = URL.createObjectURL(file)
    if (imageRef.current) imageRef.current.src = url
    return () => {
      active.current = false
      conversion.current?.abort()
      URL.revokeObjectURL(url)
    }
  }, [file])

  async function handleImageError() {
    setDimensions(null)
    if (!isHeicImage(file) || conversionAttempted.current || !conversion.current) {
      setConverting(false)
      setError(true)
      return
    }
    conversionAttempted.current = true
    setConverting(true)
    try {
      const src = await convertAvatarForPreview(file, conversion.current.signal)
      if (active.current && imageRef.current) imageRef.current.src = src
    } catch {
      if (active.current) {
        setConverting(false)
        setError(true)
      }
    }
  }

  const area = dimensions ? getAvatarCrop(dimensions.width, dimensions.height, crop) : null
  async function save() {
    if (!imageRef.current || !dimensions || busy) return
    setBusy(true)
    try {
      const result = await prepareAvatar(imageRef.current, crop)
      if (active.current) onSave(result)
    } catch {
      if (active.current) {
        setError(true)
        setBusy(false)
      }
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        ref={cardRef}
        className="modal-card avatar-crop-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="avatar-crop-title"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="avatar-crop-title">{t('profile.cropTitle')}</h2>
        <p>{t('profile.cropHint')}</p>
        <div
          className="avatar-crop-preview"
          data-dragging={dragging || undefined}
          onPointerDown={(event) => {
            if (!dimensions || busy || event.button !== 0) return
            setDragging(true)
            event.currentTarget.setPointerCapture(event.pointerId)
            drag.current = { x: event.clientX, y: event.clientY, cropX: crop.x, cropY: crop.y }
          }}
          onPointerMove={(event) => {
            if (!drag.current || !dimensions || !area) return
            const scale = event.currentTarget.getBoundingClientRect().width / area.size
            const { x, y, cropX, cropY } = drag.current
            const move = (value: number, delta: number, overflow: number) =>
              overflow > 0 ? Math.max(-1, Math.min(1, value - (2 * delta) / overflow)) : 0
            setCrop((current) => ({
              ...current,
              x: move(cropX, event.clientX - x, (dimensions.width - area.size) * scale),
              y: move(cropY, event.clientY - y, (dimensions.height - area.size) * scale),
            }))
          }}
          onPointerUp={() => {
            setDragging(false)
            drag.current = null
          }}
          onPointerCancel={() => {
            setDragging(false)
            drag.current = null
          }}
          onLostPointerCapture={() => {
            setDragging(false)
            drag.current = null
          }}
        >
          <img
            ref={imageRef}
            alt={t('profile.cropPreview')}
            draggable={false}
            onLoad={(event) => {
              setDimensions({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })
              setConverting(false)
              setError(false)
            }}
            onError={() => void handleImageError()}
            style={
              dimensions && area
                ? {
                    width: `${(dimensions.width / Math.min(dimensions.width, dimensions.height)) * 100}%`,
                    height: `${(dimensions.height / Math.min(dimensions.width, dimensions.height)) * 100}%`,
                    transform: `scale(${crop.zoom}) translate(${(-area.x / dimensions.width) * 100}%, ${(-area.y / dimensions.height) * 100}%)`,
                  }
                : { visibility: 'hidden' }
            }
          />
          <span className="avatar-crop-mask" aria-hidden="true" />
          <div className="avatar-crop-zoom" onPointerDown={(event) => event.stopPropagation()}>
            <button
              type="button"
              aria-label={t('profile.cropZoomOut')}
              disabled={!dimensions || busy || crop.zoom <= 1}
              onClick={() => setCrop((current) => ({ ...current, zoom: Math.max(1, current.zoom - 0.25) }))}
            >
              <span aria-hidden="true">−</span>
            </button>
            <button
              type="button"
              aria-label={t('profile.cropZoomIn')}
              disabled={!dimensions || busy || crop.zoom >= 3}
              onClick={() => setCrop((current) => ({ ...current, zoom: Math.min(3, current.zoom + 0.25) }))}
            >
              <span aria-hidden="true">+</span>
            </button>
          </div>
        </div>
        {converting && <p role="status">{t('media.processing')}</p>}
        {error && <p role="alert">{t('profile.photoUploadFailed')}</p>}
        <div className="avatar-crop-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="button" className="btn btn-primary" disabled={!dimensions || busy} onClick={save}>
            {t('profile.cropSave')}
          </button>
        </div>
      </div>
    </div>
  )
}
