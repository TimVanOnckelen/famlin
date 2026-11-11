import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../src/table'

describe('responsive table (card mode below the 720px cut-over)', () => {
  it('marks labeled cells for label/value pairs and unlabeled cells as the actions row', () => {
    const { container } = render(
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell data-label="Name">Anna</TableCell>
            <TableCell>
              <button type="button">Delete</button>
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    )
    const header = container.querySelector('[data-slot="table-header"]')!
    expect(header.className).toContain('max-md:sr-only')
    const row = container.querySelector('[data-slot="table-row"]')!
    expect(row.className).toContain('max-md:block')
    expect(row.className).toContain('max-md:rounded-xl')

    const labeled = container.querySelector('td[data-label]')!
    expect(labeled.getAttribute('data-label')).toBe('Name')
    expect(labeled.className).toContain('max-md:before:content-[attr(data-label)]')

    const actions = container.querySelector('td:not([data-label])')!
    expect(actions.getAttribute('data-card-actions')).toBe('true')
    expect(actions.querySelector('[data-slot=table-cell-value]')!.className).toContain('max-md:justify-end')
  })
  it('keeps an empty-state spanning cell out of the action footer', () => {
    const { container } = render(
      <Table>
        <TableBody>
          <TableRow>
            <TableCell colSpan={3}>No records</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    )
    expect(container.querySelector('td')!.hasAttribute('data-card-actions')).toBe(false)
    expect(container.querySelector('td')!.colSpan).toBe(3)
  })
})
