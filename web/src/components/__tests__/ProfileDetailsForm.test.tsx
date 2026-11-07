import { useState } from 'react'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { updateMe, type User } from '@famlin/api-client'
import { ProfileDetailsForm } from '../ProfileDetailsForm'
import { makeUser, renderWithQueryClient } from '@/test/fixtures'

vi.mock('@famlin/api-client', async (original) => ({
  ...(await original<typeof import('@famlin/api-client')>()),
  updateMe: vi.fn(),
}))
beforeEach(() => vi.resetAllMocks())
function Example() {
  const [user, setUser] = useState<User>(makeUser())
  return <ProfileDetailsForm user={user} onSaved={setUser} />
}

it('saves normalized details and updates the form from the server response', async () => {
  const user = userEvent.setup()
  vi.mocked(updateMe).mockImplementation(async (details) => ({ ...makeUser(), ...details }))
  renderWithQueryClient(<Example />)
  const save = screen.getByRole('button', { name: 'Save details' })
  expect(save).toBeDisabled()
  await user.clear(screen.getByRole('textbox', { name: 'Name' }))
  await user.type(screen.getByRole('textbox', { name: 'Name' }), '  New Name  ')
  await user.clear(screen.getByRole('textbox', { name: 'Email address' }))
  await user.type(screen.getByRole('textbox', { name: 'Email address' }), 'NEW@example.com')
  await user.click(save)
  await waitFor(() => expect(updateMe).toHaveBeenCalledWith({ name: 'New Name', email: 'new@example.com' }))
  expect(await screen.findByRole('status')).toHaveTextContent('Your details have been saved')
  expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('New Name')
  expect(save).toBeDisabled()
})

it('explains duplicate email and retains unsaved input', async () => {
  const user = userEvent.setup()
  vi.mocked(updateMe).mockRejectedValue({ isAxiosError: true, response: { status: 409 } })
  renderWithQueryClient(<Example />)
  const email = screen.getByRole('textbox', { name: 'Email address' })
  await user.clear(email)
  await user.type(email, 'taken@example.com')
  await user.click(screen.getByRole('button', { name: 'Save details' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('This email address is already in use')
  expect(email).toHaveValue('taken@example.com')
  expect(email).toHaveAttribute('aria-invalid', 'true')
  await user.type(email, 'x')
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

it('rejects invalid email and whitespace-only names without submitting', async () => {
  const user = userEvent.setup()
  renderWithQueryClient(<Example />)
  const name = screen.getByRole('textbox', { name: 'Name' })
  await user.clear(name)
  await user.type(name, '   ')
  expect(screen.getByRole('button', { name: 'Save details' })).toBeDisabled()
  await user.type(name, 'Name')
  const email = screen.getByRole('textbox', { name: 'Email address' })
  await user.clear(email)
  await user.type(email, 'invalid-email')
  await user.click(screen.getByRole('button', { name: 'Save details' }))
  expect(updateMe).not.toHaveBeenCalled()
})
