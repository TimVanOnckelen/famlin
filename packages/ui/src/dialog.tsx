'use client'

import * as React from 'react'
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog'
import { cn } from './lib/utils'

import { Button } from './button'
import { XIcon } from 'lucide-react'

function Dialog({ ...props }: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({ ...props }: DialogPrimitive.Trigger.Props) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({ ...props }: DialogPrimitive.Portal.Props) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({ ...props }: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({ className, ...props }: DialogPrimitive.Backdrop.Props) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-overlay"
      className={cn(
        'fixed inset-0 isolate z-50 bg-black/10 duration-100 supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0',
        className
      )}
      {...props}
    />
  )
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  closeLabel,
  ...props
}: DialogPrimitive.Popup.Props & {
  showCloseButton?: boolean
  closeLabel?: string
}) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Popup
        data-slot="dialog-content"
        className={cn(
          'fixed top-1/2 left-1/2 z-50 grid w-full max-w-[calc(100%_-_2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-lg bg-popover p-6 text-base text-popover-foreground ring-1 ring-foreground/10 duration-100 outline-none desktop:max-w-sm data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95',
          // Compact screens: a fullscreen sheet that scrolls as a whole, with
          // a sticky DialogHeader and sticky DialogActions.
          'max-desktop:inset-0 max-desktop:flex max-desktop:h-dvh max-desktop:max-h-none max-desktop:max-w-none max-desktop:translate-x-0 max-desktop:translate-y-0 max-desktop:flex-col max-desktop:gap-0 max-desktop:overflow-y-auto max-desktop:overscroll-contain max-desktop:rounded-none max-desktop:p-0 max-desktop:ring-0 max-desktop:data-open:zoom-in-100 max-desktop:data-closed:zoom-out-100',
          className
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            render={<Button variant="ghost" className="absolute top-2 right-2" size="icon-sm" />}
          >
            <XIcon />
            <span className="sr-only">{closeLabel}</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Popup>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="dialog-header"
      className={cn(
        'flex flex-col gap-2',
        'max-desktop:sticky max-desktop:top-0 max-desktop:z-10 max-desktop:shrink-0 max-desktop:border-b max-desktop:bg-popover max-desktop:py-2 max-desktop:pr-2 max-desktop:pl-4',
        className
      )}
      {...props}
    />
  )
}

/** Dialog content between the header and the actions; supplies the sheet's side padding on compact screens. */
function DialogBody({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="dialog-body"
      className={cn(
        'grid min-w-0 gap-4 max-desktop:flex max-desktop:flex-1 max-desktop:flex-col max-desktop:p-4',
        className
      )}
      {...props}
    />
  )
}

/**
 * The dialog's action buttons. Right-aligned on desktop; on compact screens a
 * full-width bar that sticks to the bottom of the sheet so the primary action
 * stays reachable however long the content is. Place it as the last child of
 * DialogBody (or of a form inside it).
 */
function DialogActions({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="dialog-actions"
      className={cn(
        'mt-2 flex flex-wrap justify-end gap-3',
        'max-desktop:sticky max-desktop:bottom-0 max-desktop:z-10 max-desktop:-mx-4 max-desktop:-mb-4 max-desktop:mt-auto max-desktop:flex-nowrap max-desktop:border-t max-desktop:bg-popover max-desktop:px-4 max-desktop:pt-3 max-desktop:pb-[max(0.75rem,env(safe-area-inset-bottom))] max-desktop:*:flex-1',
        className
      )}
      {...props}
    />
  )
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<'div'> & {
  showCloseButton?: boolean
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        '-mx-4 -mb-4 flex flex-col-reverse gap-2 rounded-b-xl border-t bg-muted/50 p-4 sm:flex-row sm:justify-end',
        className
      )}
      {...props}
    >
      {children}
      {showCloseButton && <DialogPrimitive.Close render={<Button variant="outline" />}>Close</DialogPrimitive.Close>}
    </div>
  )
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn('font-heading text-xl leading-tight font-extrabold', className)}
      {...props}
    />
  )
}

function DialogDescription({ className, ...props }: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        'text-sm text-muted-foreground *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground',
        className
      )}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogActions,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
