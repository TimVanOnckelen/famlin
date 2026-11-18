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
  // A new email needs the current password before it can be saved.
  expect(save).toBeDisabled()
  await user.type(screen.getByLabelText('Current password'), 'secret-pass')
  await user.click(save)
  await waitFor(() =>
    expect(updateMe).toHaveBeenCalledWith({
      name: 'New Name',
      email: 'new@example.com',
      currentPassword: 'secret-pass',
    })
  )
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
  await user.type(screen.getByLabelText('Current password'), 'secret-pass')
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

it('only asks for the password when the email changes', async () => {
  const user = userEvent.setup()
  vi.mocked(updateMe).mockImplementation(async (details) => ({ ...makeUser(), ...details }))
  renderWithQueryClient(<Example />)
  await user.type(screen.getByRole('textbox', { name: 'Name' }), ' Jr')
  expect(screen.queryByLabelText('Current password')).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Save details' }))
  await waitFor(() => expect(updateMe).toHaveBeenCalled())
  expect(vi.mocked(updateMe).mock.calls[0][0]).not.toHaveProperty('currentPassword')
})

it('explains a wrong current password', async () => {
  const user = userEvent.setup()
  vi.mocked(updateMe).mockRejectedValue({
    isAxiosError: true,
    response: { status: 403, data: { code: 'currentPasswordIncorrect' } },
  })
  renderWithQueryClient(<Example />)
  const email = screen.getByRole('textbox', { name: 'Email address' })
  await user.clear(email)
  await user.type(email, 'new@example.com')
  await user.type(screen.getByLabelText('Current password'), 'wrong')
  await user.click(screen.getByRole('button', { name: 'Save details' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Your current password is incorrect.')
})

it('asks an account without a password to sign in again when the server wants a recent sign-in', async () => {
  const user = userEvent.setup()
  vi.mocked(updateMe).mockRejectedValue({
    isAxiosError: true,
    response: { status: 403, data: { code: 'recentSignInRequired' } },
  })
  function NoPassword() {
    const [current, setCurrent] = useState<User>({ ...makeUser(), hasPassword: false })
    return <ProfileDetailsForm user={current} onSaved={setCurrent} />
  }
  renderWithQueryClient(<NoPassword />)
  const email = screen.getByRole('textbox', { name: 'Email address' })
  await user.clear(email)
  await user.type(email, 'new@example.com')
  expect(screen.queryByLabelText('Current password')).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Save details' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('sign out and sign in again')
})
