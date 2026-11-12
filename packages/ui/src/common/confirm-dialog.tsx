import { useRef } from 'react'
import { useMediaQuery } from '../hooks/use-media-query'
import { Button } from '../button'
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogTitle,
  ResponsiveDialogDescription,
} from './responsive-dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../alert-dialog'

interface ConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  confirmLabel: string
  cancelLabel: string
  onConfirm: () => void
  busy?: boolean
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel,
  onConfirm,
  busy = false,
}: ConfirmDialogProps) {
  const desktop = useMediaQuery('(min-width: 721px)')
  const cancelRef = useRef<HTMLButtonElement>(null)
  const handleOpenChange = (nextOpen: boolean) => {
    if (!busy) onOpenChange(nextOpen)
  }

  if (desktop === undefined) return null
  if (!desktop) {
    return (
      <ResponsiveDialog open={open} onOpenChange={handleOpenChange}>
        <ResponsiveDialogContent role="alertdialog" initialFocus={cancelRef} showCloseButton={false}>
          <div className="shrink-0 border-b px-4 py-4">
            <ResponsiveDialogTitle>{title}</ResponsiveDialogTitle>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            <ResponsiveDialogDescription className="text-pretty [overflow-wrap:anywhere]">
              {description}
            </ResponsiveDialogDescription>
          </div>
          <div className="flex shrink-0 flex-col-reverse gap-2 border-t bg-muted/50 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <Button ref={cancelRef} variant="outline" disabled={busy} onClick={() => handleOpenChange(false)}>
              {cancelLabel}
            </Button>
            <Button variant="destructive" disabled={busy} onClick={onConfirm}>
              {confirmLabel}
            </Button>
          </div>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    )
  }
  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>{cancelLabel}</AlertDialogCancel>
          <AlertDialogAction variant="destructive" disabled={busy} onClick={onConfirm}>
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
