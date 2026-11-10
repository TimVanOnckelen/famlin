import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NavShell } from '../src/common/nav-shell'
import { COMPACT_MEDIA_QUERY } from '../src/lib/use-compact-layout'
import { Table, TableActionsCell, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../src/table'
import { Dialog, DialogActions, DialogBody, DialogContent, DialogHeader, DialogTitle } from '../src/dialog'

// jsdom does no layout, so these pin the contracts the responsive CSS relies
// on (slots, data attributes, sheet classes) and the drawer's behavior; the
// e2e admin-mobile suite checks the actual layout at 360px in a browser.

function setViewport(compact: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: compact && query === COMPACT_MEDIA_QUERY,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }))
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

function Shell() {
  return (
    <NavShell
      brand={<span>Brand</span>}
      menuLabel="Menu"
      openMenuLabel="Open menu"
      closeMenuLabel="Close menu"
      sidebar={
        <nav>
          <a href="#users">Users</a>
        </nav>
      }
    >
      <h2>Page</h2>
    </NavShell>
  )
}

describe('NavShell', () => {
  it('derives its media query from the desktop breakpoint token', () => {
    expect(COMPACT_MEDIA_QUERY).toBe('(width < 45.0625rem)')
  })

  it('renders the sidebar inline on desktop, without a menu button', () => {
    setViewport(false)
    render(<Shell />)
    expect(screen.getByRole('link', { name: 'Users' }).closest('[data-slot="nav-shell-sidebar"]')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Open menu' })).toBeNull()
    expect(screen.getByRole('main').textContent).toBe('Page')
  })

  it('opens the sidebar as a drawer on compact screens and closes it on link, Esc and close button', async () => {
    setViewport(true)
    const user = userEvent.setup()
    render(<Shell />)
    expect(screen.queryByRole('link', { name: 'Users' })).toBeNull()
    const menuButton = screen.getByRole('button', { name: 'Open menu' })
    expect(menuButton.getAttribute('aria-expanded')).toBe('false')

    await user.click(menuButton)
    const drawer = await screen.findByRole('dialog', { name: 'Menu' })
    expect(menuButton.getAttribute('aria-expanded')).toBe('true')
    // Focus moves into the drawer.
    await waitFor(() => expect(drawer.contains(document.activeElement)).toBe(true))

    await user.click(screen.getByRole('link', { name: 'Users' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    await user.click(menuButton)
    await screen.findByRole('dialog', { name: 'Menu' })
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(menuButton))

    await user.click(menuButton)
    await user.click(await screen.findByRole('button', { name: 'Close menu' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })
})

describe('stacked Table', () => {
  it('marks the container and gives labelled cells a value wrapper and actions their own slot', () => {
    const { container } = render(
      <Table stacked>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell>Anna</TableCell>
            <TableCell label="Email">
              anna@example.com <b>SSO</b>
            </TableCell>
            <TableActionsCell>
              <button type="button">Edit</button>
            </TableActionsCell>
          </TableRow>
        </TableBody>
      </Table>
    )
    expect(container.querySelector('[data-slot="table-container"]')?.hasAttribute('data-stacked')).toBe(true)
    const email = screen.getByRole('cell', { name: 'anna@example.com SSO' })
    expect(email.getAttribute('data-label')).toBe('Email')
    // One wrapper, so a cell's label and value are always two grid items.
    expect(email.children).toHaveLength(1)
    expect(email.firstElementChild?.getAttribute('data-slot')).toBe('table-cell-value')
    expect(screen.getByRole('cell', { name: 'Anna' }).querySelector('[data-slot="table-cell-value"]')).toBeNull()
    expect(screen.getByRole('cell', { name: 'Edit' }).hasAttribute('data-actions')).toBe(true)
  })

  it('leaves an ordinary table alone', () => {
    const { container } = render(
      <Table>
        <TableBody>
          <TableRow>
            <TableCell>Anna</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    )
    expect(container.querySelector('[data-slot="table-container"]')?.hasAttribute('data-stacked')).toBe(false)
  })
})

describe('Dialog sheet', () => {
  it('is a fullscreen sheet below the desktop breakpoint, with sticky header and actions', () => {
    render(
      <Dialog open>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Edit</DialogTitle>
          </DialogHeader>
          <DialogBody>
            <form>
              <DialogActions>
                <button type="submit">Save</button>
              </DialogActions>
            </form>
          </DialogBody>
        </DialogContent>
      </Dialog>
    )
    const dialog = screen.getByRole('dialog', { name: 'Edit' })
    for (const cls of [
      'max-desktop:inset-0',
      'max-desktop:h-dvh',
      'max-desktop:max-w-none',
      'max-desktop:rounded-none',
    ])
      expect(dialog.className).toContain(cls)
    expect(dialog.querySelector('[data-slot="dialog-header"]')?.className).toContain('max-desktop:sticky')
    const actions = screen.getByRole('button', { name: 'Save' }).parentElement!
    expect(actions.getAttribute('data-slot')).toBe('dialog-actions')
    expect(actions.className).toContain('max-desktop:sticky')
    expect(actions.className).toContain('max-desktop:bottom-0')
  })
})
