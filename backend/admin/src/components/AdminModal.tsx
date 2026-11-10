import { useRef, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from '@famlin/ui/dialog'
import { Button } from '@famlin/ui/button'
import { X } from 'lucide-react'

export function AdminModal({
  title,
  children,
  onClose,
  busy = false,
  descriptionId,
  initialFocusSelector = 'input:not([type="hidden"]):not([aria-hidden="true"]), textarea, [data-slot="select-trigger"]:not(:disabled)',
}: {
  title: ReactNode
  children: ReactNode
  onClose: () => void
  busy?: boolean
  descriptionId?: string
  initialFocusSelector?: string
}) {
  const { t } = useTranslation()
  const ref = useRef<HTMLDivElement>(null)
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose()
      }}
    >
      <DialogContent
        ref={ref}
        showCloseButton={false}
        aria-describedby={descriptionId}
        initialFocus={() => ref.current?.querySelector<HTMLElement>(initialFocusSelector) ?? ref.current}
        className="desktop:max-h-[85svh] desktop:max-w-lg desktop:overflow-y-auto"
      >
        <DialogHeader className="flex-row items-center justify-between gap-4">
          <DialogTitle>{title}</DialogTitle>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t('common.close')}
            disabled={busy}
            onClick={onClose}
          >
            <X />
          </Button>
        </DialogHeader>
        {/* A fullscreen sheet on compact screens; put buttons in DialogActions so they stay in view. */}
        <DialogBody>{children}</DialogBody>
      </DialogContent>
    </Dialog>
  )
}
