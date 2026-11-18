import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { UserAvatar } from '../src/common/user-avatar'
import { AuthShell } from '../src/common/auth-shell'
import { SelectField } from '../src/common/select-field'
import { Dialog, DialogContent, DialogTitle } from '../src/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '../src/dropdown-menu'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../src/tabs'

describe('shared presentation', () => {
  it('accepts a consumer logo and children', () => {
    render(
      <AuthShell logo={<span>Family logo</span>}>
        <h1>Sign in</h1>
      </AuthShell>
    )
    expect(screen.getByText('Family logo')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeTruthy()
  })

  it('shows deterministic initials with and without a failed photo', async () => {
    const { container, rerender } = render(<UserAvatar name="Anna Smith" />)
    expect(screen.getByText('AS')).toBeTruthy()
    const color = screen.getByText('AS').style.backgroundColor
    rerender(<UserAvatar name="Anna Smith" src="/missing.jpg" className="custom-avatar" />)
    const image = container.querySelector('img')
    expect(image?.getAttribute('src')).toBe('/missing.jpg')
    if (image) fireEvent.error(image)
    expect(image?.hasAttribute('data-error')).toBe(true)
    await waitFor(() => expect(screen.getByText('AS').style.backgroundColor).toBe(color))
    expect(container.firstElementChild?.className).toContain('custom-avatar')
  })

  it('displays a loaded photo and retains its image element on rerender', async () => {
    const { container, rerender } = render(<UserAvatar name="Anna Smith" src="blob:ready-photo" />)
    const image = container.querySelector('img')!
    fireEvent.load(image)
    await waitFor(() => expect(image.getAttribute('aria-hidden')).toBeNull())
    await waitFor(() => expect(screen.queryByText('AS')).toBeNull())
    rerender(<UserAvatar name="Anna Smith" src="blob:ready-photo" className="updated" />)
    expect(container.querySelector('img')).toBe(image)
    expect(image.getAttribute('src')).toBe('blob:ready-photo')
    expect(image.hasAttribute('data-loading')).toBe(false)
  })

  it('supports keyboard selection inside a modal dialog', async () => {
    function Example() {
      const [value, setValue] = useState('one')
      return (
        <Dialog open>
          <DialogContent>
            <DialogTitle>Choose</DialogTitle>
            <SelectField
              aria-label="Option"
              items={[
                { value: 'one', label: 'First' },
                { value: 'two', label: 'Second' },
              ]}
              value={value}
              onValueChange={setValue}
            />
            <output>{value}</output>
          </DialogContent>
        </Dialog>
      )
    }
    const user = userEvent.setup()
    render(<Example />)
    const trigger = screen.getByRole('combobox', { name: 'Option' })
    trigger.focus()
    await user.keyboard('{ArrowDown}')
    expect(await screen.findByRole('listbox')).toBeTruthy()
    await user.keyboard('{End}{Enter}')
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('two'))
    await waitFor(() => expect(document.activeElement).toBe(trigger))
  })

  it('moves between tab panels by keyboard and retains reduced motion classes', async () => {
    const user = userEvent.setup()
    const { container } = render(
      <Tabs defaultValue="one">
        <TabsList>
          <TabsTrigger value="one">First</TabsTrigger>
          <TabsTrigger value="two">Second</TabsTrigger>
        </TabsList>
        <TabsContent value="one">First panel</TabsContent>
        <TabsContent value="two">Second panel</TabsContent>
      </Tabs>
    )
    screen.getByRole('tab', { name: 'First' }).focus()
    await user.keyboard('{ArrowRight}')
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Second' }))
    await user.keyboard('{Enter}')
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Second' }).getAttribute('aria-selected')).toBe('true'))
    expect(screen.getByRole('tabpanel').textContent).toBe('Second panel')
    expect(container.querySelector('[data-slot="tabs-indicator"]')?.className).toContain(
      'motion-reduce:transition-none'
    )
    expect(screen.getByRole('tabpanel').className).toContain('motion-reduce:transition-none')
  })
})

describe('dropdown menu', () => {
  it('opens from the trigger, runs the item action and closes', async () => {
    const user = userEvent.setup()
    let clicked = 0
    render(
      <DropdownMenu>
        <DropdownMenuTrigger>Account</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onClick={() => clicked++}>Log out</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    )
    await user.click(screen.getByRole('button', { name: 'Account' }))
    const item = await screen.findByRole('menuitem', { name: 'Log out' })
    await user.click(item)
    expect(clicked).toBe(1)
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
  })

  it('selects radio items by keyboard and keeps the checked state', async () => {
    function Example() {
      const [lang, setLang] = useState('en')
      return (
        <DropdownMenu>
          <DropdownMenuTrigger>Settings</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuRadioGroup value={lang} onValueChange={(value) => setLang(String(value))}>
              <DropdownMenuRadioItem value="en">English</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="nl">Nederlands</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      )
    }
    const user = userEvent.setup()
    render(<Example />)
    const trigger = screen.getByRole('button', { name: 'Settings' })
    trigger.focus()
    await user.keyboard('{ArrowDown}')
    expect(await screen.findByRole('menu')).toBeTruthy()
    // Opening highlights the first item; move to the second and select it.
    // Radio items keep the menu open (Base UI's closeOnClick default).
    await user.keyboard('{ArrowDown}{Enter}')
    const dutch = await screen.findByRole('menuitemradio', { name: 'Nederlands' })
    await waitFor(() => expect(dutch.getAttribute('aria-checked')).toBe('true'))
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
    await user.click(trigger)
    expect((await screen.findByRole('menuitemradio', { name: 'Nederlands' })).getAttribute('aria-checked')).toBe('true')
  })

  it('opens a submenu from its trigger', async () => {
    const user = userEvent.setup()
    render(
      <DropdownMenu>
        <DropdownMenuTrigger>Account</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Language</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem>English</DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuContent>
      </DropdownMenu>
    )
    await user.click(screen.getByRole('button', { name: 'Account' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Language' }))
    expect(await screen.findByRole('menuitem', { name: 'English' })).toBeTruthy()
  })
})
