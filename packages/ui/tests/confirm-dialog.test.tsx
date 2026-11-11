import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ConfirmDialog } from '../src/common/confirm-dialog'

function media(desktop: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: desktop,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }))
}

const props = {
  open: true,
  title: 'Delete post?',
  description: 'This permanently removes the post.',
  confirmLabel: 'Delete',
  cancelLabel: 'Cancel',
}

describe('responsive confirmation', () => {
  it('keeps the desktop alert dialog', async () => {
    media(true)
    render(<ConfirmDialog {...props} onOpenChange={vi.fn()} onConfirm={vi.fn()} />)
    expect((await screen.findByRole('alertdialog')).getAttribute('data-slot')).toBe('alert-dialog-content')
  })

  it('uses a mobile drawer, focuses Cancel, and confirms only on explicit action', async () => {
    media(false)
    const onConfirm = vi.fn()
    const onOpenChange = vi.fn()
    render(<ConfirmDialog {...props} onOpenChange={onOpenChange} onConfirm={onConfirm} />)
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog.getAttribute('data-slot')).toBe('drawer-popup')
    expect(dialog.getAttribute('aria-labelledby')).toBeTruthy()
    expect(dialog.getAttribute('aria-describedby')).toBeTruthy()
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' })))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(onConfirm).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('blocks cancel, Escape, and repeat confirmation while busy on mobile', async () => {
    media(false)
    const onOpenChange = vi.fn()
    const onConfirm = vi.fn()
    render(<ConfirmDialog {...props} busy onOpenChange={onOpenChange} onConfirm={onConfirm} />)
    const dialog = await screen.findByRole('alertdialog')
    expect(screen.getByRole('button', { name: 'Cancel' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: 'Delete' }).hasAttribute('disabled')).toBe(true)
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(onConfirm).not.toHaveBeenCalled()
  })
})
