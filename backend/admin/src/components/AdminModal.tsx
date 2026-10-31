import { useEffect, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { Icon } from './Icon'

let openModals = 0
let originalOverflow = ''

export function AdminModal({
  title,
  children,
  onClose,
  busy = false,
  descriptionId,
  initialFocusSelector = 'input, textarea, select',
}: {
  title: string
  children: ReactNode
  onClose: () => void
  busy?: boolean
  descriptionId?: string
  initialFocusSelector?: string
}) {
  const { t } = useTranslation()
  const ref = useRef<HTMLDialogElement>(null)
  const startedOutside = useRef(false)
  const titleId = useId()
  useEffect(() => {
    const dialog = ref.current!
    if (openModals++ === 0) {
      originalOverflow = document.body.style.overflow
      document.body.style.overflow = 'hidden'
    }
    dialog.showModal()
    dialog.querySelector<HTMLElement>(initialFocusSelector)?.focus()
    return () => {
      dialog.close()
      if (--openModals === 0) document.body.style.overflow = originalOverflow
    }
  }, [initialFocusSelector])

  function isBackdrop(event: React.MouseEvent<HTMLDialogElement> | React.PointerEvent<HTMLDialogElement>) {
    if (event.target !== event.currentTarget) return false
    const bounds = event.currentTarget.getBoundingClientRect()
    return (
      event.clientX < bounds.left ||
      event.clientX > bounds.right ||
      event.clientY < bounds.top ||
      event.clientY > bounds.bottom
    )
  }

  return createPortal(
    <dialog
      ref={ref}
      className="modal admin-dialog"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onCancel={(event) => {
        event.preventDefault()
        event.stopPropagation()
        if (!busy) onClose()
      }}
      onPointerDown={(event) => {
        startedOutside.current = isBackdrop(event)
      }}
      onClick={(event) => {
        if (startedOutside.current && isBackdrop(event) && !busy) {
          event.stopPropagation()
          onClose()
        }
        startedOutside.current = false
      }}
    >
      <div className="admin-modal-header">
        <h3 id={titleId}>{title}</h3>
        <button type="button" className="icon-button" aria-label={t('common.close')} disabled={busy} onClick={onClose}>
          <Icon name="x" size={18} />
        </button>
      </div>
      {children}
    </dialog>,
    document.body
  )
}
