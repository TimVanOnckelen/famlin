'use client'

import * as React from 'react'
import { useMediaQuery } from '../hooks/use-media-query'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../dialog'
import { Drawer, DrawerClose, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from '../drawer'
import { cn } from '../lib/utils'

// The mobile cut-over from @famlin/design-tokens (breakpoint.mobile = 720px),
// pinned in packages/ui/styles.css as Tailwind's --breakpoint-md.
const DESKTOP_QUERY = '(min-width: 721px)'

interface ResponsiveDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onOpenChangeComplete?: (open: boolean) => void
  children: React.ReactNode
}

const ResponsiveDialogMediaContext = React.createContext<boolean | null>(null)

function useResponsiveDialogMedia() {
  const desktop = React.useContext(ResponsiveDialogMediaContext)
  if (desktop === null) {
    throw new Error('ResponsiveDialog subcomponents must be used within a ResponsiveDialog.')
  }
  return desktop
}

// Responsive dialog per https://ui.shadcn.com/docs/components/base/drawer#responsive:
// a Dialog on desktop and a Drawer (bottom sheet) on mobile. The media switch
// lives here so consumers render one self-adapting tree.
function ResponsiveDialog({ open, onOpenChange, onOpenChangeComplete, children }: ResponsiveDialogProps) {
  const desktop = useMediaQuery(DESKTOP_QUERY)
  if (desktop === undefined) {
    return null
  }
  return (
    <ResponsiveDialogMediaContext.Provider value={desktop}>
      {desktop ? (
        <Dialog open={open} onOpenChange={onOpenChange} onOpenChangeComplete={onOpenChangeComplete}>
          {children}
        </Dialog>
      ) : (
        <MobileDrawer open={open} onOpenChange={onOpenChange} onOpenChangeComplete={onOpenChangeComplete}>
          {children}
        </MobileDrawer>
      )}
    </ResponsiveDialogMediaContext.Provider>
  )
}

// The Drawer animates with transitions, which Base UI only runs on real open
// changes — a popup that mounts already open never animates in. Mirror the
// parent's `open` but always mount closed so opening is a genuine transition.
function MobileDrawer({ open, onOpenChange, onOpenChangeComplete, children }: ResponsiveDialogProps) {
  const [presented, setPresented] = React.useState(false)

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPresented(open)
  }, [open])

  return (
    <Drawer open={presented} onOpenChange={onOpenChange} onOpenChangeComplete={onOpenChangeComplete}>
      {children}
    </Drawer>
  )
}

function ResponsiveDialogContent({
  className,
  dialogClassName,
  drawerClassName,
  showCloseButton = true,
  closeLabel,
  ...props
}: Omit<React.ComponentProps<typeof DialogContent>, 'className' | 'render' | 'style'> & {
  className?: string
  style?: React.CSSProperties
  dialogClassName?: string
  drawerClassName?: string
}) {
  const desktop = useResponsiveDialogMedia()
  if (desktop) {
    return (
      <DialogContent
        className={cn(className, dialogClassName)}
        showCloseButton={showCloseButton}
        closeLabel={closeLabel}
        {...props}
      />
    )
  }
  return <DrawerContent className={cn(className, drawerClassName)} {...props} />
}

function ResponsiveDialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  const desktop = useResponsiveDialogMedia()
  return desktop ? <DialogHeader className={className} {...props} /> : <DrawerHeader className={className} {...props} />
}

function ResponsiveDialogTitle({ className, ...props }: React.ComponentProps<typeof DialogTitle>) {
  const desktop = useResponsiveDialogMedia()
  return desktop ? <DialogTitle className={className} {...props} /> : <DrawerTitle className={className} {...props} />
}

function ResponsiveDialogDescription({ className, ...props }: React.ComponentProps<typeof DialogDescription>) {
  const desktop = useResponsiveDialogMedia()
  return desktop ? (
    <DialogDescription className={className} {...props} />
  ) : (
    <DrawerDescription className={className} {...props} />
  )
}

function ResponsiveDialogClose({ ...props }: React.ComponentProps<typeof DialogClose>) {
  const desktop = useResponsiveDialogMedia()
  return desktop ? <DialogClose {...props} /> : <DrawerClose {...props} />
}

export {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogDescription,
  ResponsiveDialogClose,
}
