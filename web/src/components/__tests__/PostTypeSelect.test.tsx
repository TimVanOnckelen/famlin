import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PostTypeSelect } from '../PostTypeSelect'

const options = [
  { value: 'update', label: 'Update', description: 'Share family news', icon: 'edit-3' as const },
  { value: 'gift', label: 'Gift list', description: 'Share wishes and draw names', icon: 'gift' as const },
]
function Select() {
  const [value, setValue] = useState('update')
  return <PostTypeSelect value={value} options={options} label="Post type" onChange={setValue} />
}

it('shows descriptions and selects an option without a native select', async () => {
  const user = userEvent.setup()
  const { container } = render(<Select />)
  const trigger = screen.getByRole('combobox', { name: 'Post type' })
  expect(container.querySelector('select')).toBeNull()
  expect(trigger).toHaveTextContent('Share family news')
  await user.click(trigger)
  expect(screen.getByRole('option', { name: 'Gift list' })).toHaveAccessibleDescription('Share wishes and draw names')
  await user.click(screen.getByRole('option', { name: 'Gift list' }))
  expect(trigger).toHaveTextContent('Gift list')
  expect(trigger).toHaveAttribute('aria-expanded', 'false')
  expect(trigger).toHaveFocus()
})

it('supports keyboard selection and closes on blur', async () => {
  const user = userEvent.setup()
  render(
    <>
      <Select />
      <button>Next field</button>
    </>
  )
  const trigger = screen.getByRole('combobox')
  trigger.focus()
  await user.keyboard('{ArrowDown}{End}{Enter}')
  expect(trigger).toHaveTextContent('Gift list')
  await user.keyboard('{ArrowUp}{Home}{Enter}')
  expect(trigger).toHaveTextContent('Update')
  await user.click(trigger)
  await user.tab()
  expect(screen.getByRole('button', { name: 'Next field' })).toHaveFocus()
  expect(trigger).toHaveAttribute('aria-expanded', 'false')
})
