import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '../src/sheet'
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '../src/drawer'
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '../src/common/responsive-dialog'

function stubMatchMedia(matches: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  })
}

describe('sheet (base-nova)', () => {
  function Example({ side = 'left' as 'left' | 'right' | 'top' | 'bottom' }) {
    const [open, setOpen] = useState(false)
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>
          Open
        </button>
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent side={side} closeLabel="Close panel">
            <SheetTitle>Menu</SheetTitle>
            <SheetDescription>Navigation</SheetDescription>
            <a href="/dashboard" onClick={() => setOpen(false)}>
              Dashboard
            </a>
          </SheetContent>
        </Sheet>
      </>
    )
  }

  it('opens from the toggle, traps focus and exposes a dialog landmark with a title', async () => {
    render(<Example />)
    fireEvent.click(screen.getByRole('button', { name: 'Open' }))
    const panel = await screen.findByRole('dialog')
    expect(panel.getAttribute('data-slot')).toBe('sheet-content')
    expect(panel.getAttribute('data-side')).toBe('left')
    expect(screen.getByRole('heading', { name: 'Menu' })).toBeTruthy()
    // Focus moves into the sheet while it is open.
    await waitFor(() => expect(panel.contains(document.activeElement)).toBe(true))
  })

  it('closes on Escape', async () => {
    render(<Example />)
    fireEvent.click(screen.getByRole('button', { name: 'Open' }))
    const panel = await screen.findByRole('dialog')
    fireEvent.keyDown(panel, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('closes when the consumer wires navigation to close (admin drawer pattern)', async () => {
    render(<Example />)
    fireEvent.click(screen.getByRole('button', { name: 'Open' }))
    fireEvent.click(await screen.findByRole('link', { name: 'Dashboard' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('renders the requested side', async () => {
    render(<Example side="bottom" />)
    fireEvent.click(screen.getByRole('button', { name: 'Open' }))
    expect((await screen.findByRole('dialog')).getAttribute('data-side')).toBe('bottom')
  })
})

describe('drawer (base-nova)', () => {
  function Example() {
    const [open, setOpen] = useState(false)
    return (
      <>
        <Drawer open={open} onOpenChange={setOpen}>
          <DrawerTrigger render={<button type="button" />}>Open drawer</DrawerTrigger>
          <DrawerContent>
            <DrawerHeader>
              <DrawerTitle>Edit profile</DrawerTitle>
              <DrawerDescription>Make changes to your profile here.</DrawerDescription>
            </DrawerHeader>
            <div className="flex-1 overflow-y-auto p-4">{/* scrollable region */}</div>
            <DrawerFooter>
              <DrawerClose render={<button type="button" />}>Cancel</DrawerClose>
            </DrawerFooter>
          </DrawerContent>
        </Drawer>
      </>
    )
  }

  it('opens a bottom drawer with swipe direction and a labelled title', async () => {
    render(<Example />)
    fireEvent.click(screen.getByRole('button', { name: 'Open drawer' }))
    const popup = await screen.findByRole('dialog')
    expect(popup.getAttribute('data-slot')).toBe('drawer-popup')
    expect(popup.getAttribute('data-swipe-direction')).toBe('down')
    expect(popup.getAttribute('data-swipe-axis')).toBe('y')
    expect(screen.getByRole('heading', { name: 'Edit profile' })).toBeTruthy()
  })

  it('closes via its close control and on Escape', async () => {
    render(<Example />)
    fireEvent.click(screen.getByRole('button', { name: 'Open drawer' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    fireEvent.click(screen.getByRole('button', { name: 'Open drawer' }))
    const popup = await screen.findByRole('dialog')
    fireEvent.keyDown(popup, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })
})

describe('responsive dialog (self-adapting)', () => {
  function Example() {
    const [open, setOpen] = useState(false)
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>
          Open
        </button>
        <ResponsiveDialog open={open} onOpenChange={setOpen}>
          <ResponsiveDialogContent>
            <ResponsiveDialogHeader>
              <ResponsiveDialogTitle>Edit user</ResponsiveDialogTitle>
            </ResponsiveDialogHeader>
            <p>Body</p>
          </ResponsiveDialogContent>
        </ResponsiveDialog>
      </>
    )
  }

  it('renders a centered Dialog on desktop (≥720px)', async () => {
    stubMatchMedia(true)
    render(<Example />)
    fireEvent.click(screen.getByRole('button', { name: 'Open' }))
    const content = await screen.findByRole('dialog')
    expect(content.getAttribute('data-slot')).toBe('dialog-content')
    expect(screen.getByRole('heading', { name: 'Edit user' })).toBeTruthy()
    fireEvent.keyDown(content, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('renders a bottom Drawer on mobile (<720px)', async () => {
    stubMatchMedia(false)
    render(<Example />)
    fireEvent.click(screen.getByRole('button', { name: 'Open' }))
    const popup = await screen.findByRole('dialog')
    expect(popup.getAttribute('data-slot')).toBe('drawer-popup')
    expect(popup.getAttribute('data-swipe-direction')).toBe('down')
    fireEvent.keyDown(popup, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })
})
