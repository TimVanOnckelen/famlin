import { render } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { Toaster as Sonner } from 'sonner'
import { Toaster } from '../src/sonner'

vi.mock('sonner', () => ({ Toaster: vi.fn(() => null) }))
it('accepts a consumer theme without a theme provider', () => {
  const { rerender } = render(<Toaster theme="light" />)
  expect(Sonner).toHaveBeenLastCalledWith(expect.objectContaining({ theme: 'light' }), undefined)
  rerender(<Toaster theme="dark" />)
  expect(Sonner).toHaveBeenLastCalledWith(expect.objectContaining({ theme: 'dark' }), undefined)
  rerender(<Toaster />)
  expect(Sonner).toHaveBeenLastCalledWith(expect.objectContaining({ theme: 'system' }), undefined)
})
