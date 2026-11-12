import { useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@famlin/ui/common/responsive-dialog'
import { Button } from '@famlin/ui/button'
import { X } from 'lucide-react'

// One self-adapting modal: a Dialog on desktop, a Drawer bottom sheet on mobile
// (https://ui.shadcn.com/docs/components/base/drawer#responsive, packaged as
// @famlin/ui/common/responsive-dialog). `open` is driven here instead of
// unmounting on close so the exit transition can finish before `onClose` runs.
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
  const [open, setOpen] = useState(true)

  const initialFocus = () => ref.current?.querySelector<HTMLElement>(initialFocusSelector) ?? ref.current
  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && !busy) setOpen(false)
  }
  const handleOpenChangeComplete = (nextOpen: boolean) => {
    if (!nextOpen) onClose()
  }

  return (
    <ResponsiveDialog open={open} onOpenChange={handleOpenChange} onOpenChangeComplete={handleOpenChangeComplete}>
      <ResponsiveDialogContent
        ref={ref}
        showCloseButton={false}
        aria-describedby={descriptionId}
        initialFocus={initialFocus}
        dialogClassName="max-h-[85svh] overflow-y-auto sm:max-w-lg"
      >
        <ResponsiveDialogHeader className="flex-row items-center justify-between gap-4 text-left">
          <ResponsiveDialogTitle>{title}</ResponsiveDialogTitle>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t('common.close')}
            disabled={busy}
            onClick={() => handleOpenChange(false)}
          >
            <X />
          </Button>
        </ResponsiveDialogHeader>
        <div className="flex-1 overflow-y-auto px-4 pb-4 md:contents">{children}</div>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}
