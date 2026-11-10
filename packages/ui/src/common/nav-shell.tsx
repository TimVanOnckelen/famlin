import { useState, type MouseEvent, type ReactNode } from 'react'
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog'
import { MenuIcon, XIcon } from 'lucide-react'
import { Button } from '../button'
import { cn } from '../lib/utils'
import { useCompactLayout } from '../lib/use-compact-layout'

export interface NavShellProps {
  /** Sidebar content (brand, nav links, account controls). Rendered once: inline on desktop, in the drawer on compact screens. */
  sidebar: ReactNode
  /** Logo/wordmark for the compact top header. */
  brand: ReactNode
  children: ReactNode
  /** Translated accessible names: the drawer itself, its open (hamburger) and close buttons. */
  menuLabel: string
  openMenuLabel: string
  closeMenuLabel: string
  /** The application owns sidebar width and look; applied to the desktop aside and the drawer alike. */
  sidebarClassName?: string
  className?: string
  mainClassName?: string
}

/**
 * Application frame: a fixed sidebar on desktop; on compact (≤720px) screens a
 * top header with a menu button that opens the same sidebar as a modal drawer
 * (focus trapped, closes on Esc, backdrop tap or following a link inside it).
 */
export function NavShell({
  sidebar,
  brand,
  children,
  menuLabel,
  openMenuLabel,
  closeMenuLabel,
  sidebarClassName,
  className,
  mainClassName,
}: NavShellProps) {
  const compact = useCompactLayout()
  const [open, setOpen] = useState(false)

  // Growing past the breakpoint removes the drawer; don't let it reopen by
  // itself when the window shrinks again.
  if (!compact && open) setOpen(false)

  // Navigating replaces the page underneath, so a followed link closes the drawer.
  const closeOnLink = (event: MouseEvent) => {
    if ((event.target as HTMLElement).closest('a[href]')) setOpen(false)
  }

  return (
    <div data-slot="nav-shell" className={cn('flex min-h-svh max-desktop:flex-col', className)}>
      {compact ? (
        <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
          <header
            data-slot="nav-shell-header"
            className="sticky top-0 z-40 flex h-14 shrink-0 items-center justify-between gap-3 border-b bg-card pr-2 pl-4"
          >
            <div className="flex min-w-0 items-center gap-2">{brand}</div>
            <DialogPrimitive.Trigger
              render={<Button variant="ghost" size="icon" aria-label={openMenuLabel} aria-expanded={open} />}
            >
              <MenuIcon className="size-6" />
            </DialogPrimitive.Trigger>
          </header>
          <DialogPrimitive.Portal>
            <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-black/30 duration-150 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0" />
            <DialogPrimitive.Popup
              data-slot="nav-shell-drawer"
              aria-label={menuLabel}
              onClick={closeOnLink}
              className={cn(
                sidebarClassName,
                'fixed inset-y-0 left-0 z-50 w-[min(20rem,85vw)] overflow-y-auto overscroll-contain outline-none duration-200 data-open:animate-in data-open:slide-in-from-left data-closed:animate-out data-closed:slide-out-to-left'
              )}
            >
              <DialogPrimitive.Close
                render={
                  <Button variant="ghost" size="icon" className="absolute top-2 right-2" aria-label={closeMenuLabel} />
                }
              >
                <XIcon className="size-5" />
              </DialogPrimitive.Close>
              {sidebar}
            </DialogPrimitive.Popup>
          </DialogPrimitive.Portal>
        </DialogPrimitive.Root>
      ) : (
        <aside data-slot="nav-shell-sidebar" className={sidebarClassName}>
          {sidebar}
        </aside>
      )}
      <main data-slot="nav-shell-main" className={cn('min-w-0 flex-1', mainClassName)}>
        {children}
      </main>
    </div>
  )
}
