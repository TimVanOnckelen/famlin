'use client'

import * as React from 'react'
import { Menu as MenuPrimitive } from '@base-ui/react/menu'
import { CheckIcon, ChevronRightIcon } from 'lucide-react'
import { cn } from './lib/utils'

const DropdownMenu = MenuPrimitive.Root
const DropdownMenuGroup = MenuPrimitive.Group
const DropdownMenuRadioGroup = MenuPrimitive.RadioGroup
const DropdownMenuSub = MenuPrimitive.SubmenuRoot

function DropdownMenuTrigger({ className, ...props }: MenuPrimitive.Trigger.Props) {
  return (
    <MenuPrimitive.Trigger data-slot="dropdown-menu-trigger" className={cn('outline-none', className)} {...props} />
  )
}

function DropdownMenuContent({
  className,
  children,
  side = 'bottom',
  sideOffset = 4,
  align = 'start',
  alignOffset = 0,
  ...props
}: MenuPrimitive.Popup.Props & Pick<MenuPrimitive.Positioner.Props, 'align' | 'alignOffset' | 'side' | 'sideOffset'>) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Positioner
        side={side}
        sideOffset={sideOffset}
        align={align}
        alignOffset={alignOffset}
        className="isolate z-50"
      >
        <MenuPrimitive.Popup
          data-slot="dropdown-menu-content"
          className={cn(
            'z-50 max-h-(--available-height) min-w-40 origin-(--transform-origin) overflow-x-hidden overflow-y-auto rounded-lg bg-popover p-1.5 text-popover-foreground shadow-md ring-1 ring-foreground/10 duration-100 data-[side=bottom]:slide-in-from-top-2 data-[side=inline-end]:slide-in-from-left-2 data-[side=inline-start]:slide-in-from-right-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 motion-reduce:animate-none motion-reduce:transition-none',
            className
          )}
          {...props}
        >
          {children}
        </MenuPrimitive.Popup>
      </MenuPrimitive.Positioner>
    </MenuPrimitive.Portal>
  )
}

const itemClasses =
  "relative flex w-full cursor-default items-center gap-2 rounded-sm px-3 py-2 text-base outline-hidden select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"

function DropdownMenuItem({
  className,
  variant = 'default',
  ...props
}: MenuPrimitive.Item.Props & { variant?: 'default' | 'destructive' }) {
  return (
    <MenuPrimitive.Item
      data-slot="dropdown-menu-item"
      data-variant={variant}
      className={cn(
        itemClasses,
        'data-[variant=destructive]:text-destructive data-[variant=destructive]:data-highlighted:bg-destructive/10 data-[variant=destructive]:data-highlighted:text-destructive',
        className
      )}
      {...props}
    />
  )
}

function DropdownMenuRadioItem({ className, children, ...props }: MenuPrimitive.RadioItem.Props) {
  return (
    <MenuPrimitive.RadioItem
      data-slot="dropdown-menu-radio-item"
      className={cn(itemClasses, 'pr-8', className)}
      {...props}
    >
      {children}
      <MenuPrimitive.RadioItemIndicator
        render={<span className="pointer-events-none absolute right-2 flex size-4 items-center justify-center" />}
      >
        <CheckIcon className="pointer-events-none" />
      </MenuPrimitive.RadioItemIndicator>
    </MenuPrimitive.RadioItem>
  )
}

function DropdownMenuLabel({ className, ...props }: MenuPrimitive.GroupLabel.Props) {
  return (
    <MenuPrimitive.GroupLabel
      data-slot="dropdown-menu-label"
      className={cn('px-3 py-1.5 text-xs font-semibold text-muted-foreground', className)}
      {...props}
    />
  )
}

function DropdownMenuSeparator({ className, ...props }: MenuPrimitive.Separator.Props) {
  return (
    <MenuPrimitive.Separator
      data-slot="dropdown-menu-separator"
      className={cn('pointer-events-none -mx-1 my-1 h-px bg-border', className)}
      {...props}
    />
  )
}

function DropdownMenuSubTrigger({ className, children, ...props }: MenuPrimitive.SubmenuTrigger.Props) {
  return (
    <MenuPrimitive.SubmenuTrigger
      data-slot="dropdown-menu-sub-trigger"
      className={cn(itemClasses, className)}
      {...props}
    >
      {children}
      <ChevronRightIcon className="ml-auto size-4" />
    </MenuPrimitive.SubmenuTrigger>
  )
}

function DropdownMenuSubContent({ className, ...props }: React.ComponentProps<typeof DropdownMenuContent>) {
  return <DropdownMenuContent side="inline-end" align="start" sideOffset={2} className={className} {...props} />
}

export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuGroup,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
}
