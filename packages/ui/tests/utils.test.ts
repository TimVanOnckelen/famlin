import { expect, it } from 'vitest'
import { cn } from '../src/lib/utils'

it('combines conditional classes and lets consumer utilities override defaults', () => {
  expect(cn('p-2 size-8', ['font-bold', false], { 'text-sm': true }, 'p-4 size-10')).toBe(
    'font-bold text-sm p-4 size-10'
  )
  expect(cn('hover:bg-primary', 'hover:bg-secondary')).toBe('hover:bg-secondary')
})
