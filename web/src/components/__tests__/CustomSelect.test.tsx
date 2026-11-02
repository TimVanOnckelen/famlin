import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CustomSelect } from '../CustomSelect'

const options = [
  { value: 'standard', label: 'Standard', description: 'Delivered within a week', icon: <span aria-hidden>✉</span> },
  { value: 'express', label: 'Express', description: 'Delivered tomorrow', icon: <span aria-hidden>⚡</span> },
]
function Select() {
  const [value, setValue] = useState('standard')
  return <CustomSelect value={value} options={options} label="Delivery method" onChange={setValue} />
}

it('shows descriptions and selects an option without a native select', async () => {
  const user = userEvent.setup()
  const { container } = render(<Select />)
  const trigger = screen.getByRole('combobox', { name: 'Delivery method' })
  expect(container.querySelector('select')).toBeNull()
  expect(trigger).toHaveTextContent('Delivered within a week')
  await user.click(trigger)
  expect(screen.getByRole('option', { name: 'Express' })).toHaveAccessibleDescription('Delivered tomorrow')
  await user.click(screen.getByRole('option', { name: 'Express' }))
  expect(trigger).toHaveTextContent('Express')
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
  expect(trigger).toHaveTextContent('Express')
  await user.keyboard('{ArrowUp}{Home}{Enter}')
  expect(trigger).toHaveTextContent('Standard')
  await user.click(trigger)
  await user.tab()
  expect(screen.getByRole('button', { name: 'Next field' })).toHaveFocus()
  expect(trigger).toHaveAttribute('aria-expanded', 'false')
})

it('supports text-only options without descriptions or icons', async () => {
  const onChange = vi.fn()
  render(
    <CustomSelect
      label="Language"
      value="en"
      onChange={onChange}
      options={[
        { value: 'en', label: 'English' },
        { value: 'nl', label: 'Nederlands' },
      ]}
    />
  )
  await userEvent.click(screen.getByRole('combobox', { name: 'Language' }))
  const option = screen.getByRole('option', { name: 'Nederlands' })
  expect(option).not.toHaveAttribute('aria-describedby')
  await userEvent.click(option)
  expect(onChange).toHaveBeenCalledWith('nl')
})
