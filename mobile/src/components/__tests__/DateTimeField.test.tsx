import React from 'react'
import { Platform } from 'react-native'
import { act, fireEvent, render } from '@testing-library/react-native'
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker'
import { DateTimeField } from '@/components/DateTimeField'

jest.mock('expo-localization', () => ({ getLocales: jest.fn(() => [{ languageTag: 'en-GB' }]) }))
jest.mock('@react-native-community/datetimepicker', () => ({
  __esModule: true,
  default: jest.fn(() => null),
  DateTimePickerAndroid: { open: jest.fn() },
}))
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
jest.mock('@/components/Icon', () => ({ Icon: () => null }))

jest.setTimeout(15000)

const nativeEvent = { nativeEvent: { timestamp: 0, utcOffset: 0 } }
const originalPlatform = Platform.OS
afterEach(() => {
  Platform.OS = originalPlatform
  jest.clearAllMocks()
})

it('asks Android for the date, then the time, and saves the local date-time', async () => {
  Platform.OS = 'android'
  const onChange = jest.fn()
  const screen = await render(
    <DateTimeField value="2026-11-14T15:30" onChange={onChange} label="Starts" placeholder="Pick" />
  )
  await fireEvent.press(screen.getByLabelText('Starts'))
  const dateOptions = jest.mocked(DateTimePickerAndroid.open).mock.calls[0][0]
  expect(dateOptions.mode).toBe('date')
  dateOptions.onValueChange?.(nativeEvent, new Date(2026, 10, 20, 0, 0))

  const timeOptions = jest.mocked(DateTimePickerAndroid.open).mock.calls[1][0]
  expect(timeOptions.mode).toBe('time')
  // The picked day keeps the previously chosen time as its starting point.
  expect(timeOptions.value).toEqual(new Date(2026, 10, 20, 15, 30))
  expect(onChange).not.toHaveBeenCalled()
  timeOptions.onValueChange?.(nativeEvent, new Date(2026, 10, 20, 18, 45))
  expect(onChange).toHaveBeenCalledWith('2026-11-20T18:45')
})

it('drops an Android pick outside the bounds', async () => {
  Platform.OS = 'android'
  const onChange = jest.fn()
  const screen = await render(
    <DateTimeField value="" onChange={onChange} label="Ends" placeholder="Pick" minimum="2026-11-14T15:00" />
  )
  await fireEvent.press(screen.getByLabelText('Ends'))
  const dateOptions = jest.mocked(DateTimePickerAndroid.open).mock.calls[0][0]
  expect(dateOptions.minimumDate).toEqual(new Date(2026, 10, 14, 15, 0))
  dateOptions.onValueChange?.(nativeEvent, new Date(2026, 10, 14))
  const timeOptions = jest.mocked(DateTimePickerAndroid.open).mock.calls[1][0]
  timeOptions.onValueChange?.(nativeEvent, new Date(2026, 10, 14, 14, 0))
  expect(onChange).not.toHaveBeenCalled()
  timeOptions.onValueChange?.(nativeEvent, new Date(2026, 10, 14, 16, 0))
  expect(onChange).toHaveBeenCalledWith('2026-11-14T16:00')
})

it('saves the iOS draft only on Done, with a bounded combined picker', async () => {
  Platform.OS = 'ios'
  const onChange = jest.fn()
  const screen = await render(
    <DateTimeField value="" onChange={onChange} label="Reply by" placeholder="Pick" maximum="2026-11-14T15:00" />
  )
  await fireEvent.press(screen.getByLabelText('Reply by'))
  const props = jest.mocked(DateTimePicker).mock.calls.at(-1)![0]
  expect((props as { mode?: string }).mode).toBe('datetime')
  expect(props.maximumDate).toEqual(new Date(2026, 10, 14, 15, 0))
  await act(() => props.onValueChange?.(nativeEvent, new Date(2026, 10, 12, 20, 0)))
  expect(onChange).not.toHaveBeenCalled()
  await fireEvent.press(screen.getByText('common.done'))
  expect(onChange).toHaveBeenCalledWith('2026-11-12T20:00')
})

it('clears an optional value', async () => {
  const onChange = jest.fn()
  const screen = await render(
    <DateTimeField value="2026-11-14T15:00" onChange={onChange} label="Ends" placeholder="Pick" clearLabel="Clear" />
  )
  await fireEvent.press(screen.getByLabelText('Clear'))
  expect(onChange).toHaveBeenCalledWith('')
})

it('has no clear button for a required field', async () => {
  const screen = await render(
    <DateTimeField value="2026-11-14T15:00" onChange={jest.fn()} label="Starts" placeholder="Pick" />
  )
  expect(screen.queryByLabelText('Clear')).toBeNull()
})
