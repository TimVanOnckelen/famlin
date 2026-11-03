import React from 'react'
import { getLocales } from 'expo-localization'
import { Platform } from 'react-native'
import { act, fireEvent, render } from '@testing-library/react-native'
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker'
import { DateField } from '@/components/DateField'

jest.mock('expo-localization', () => ({ getLocales: jest.fn(() => [{ languageTag: 'en-GB' }]) }))

jest.mock('@react-native-community/datetimepicker', () => ({
  __esModule: true,
  default: jest.fn(() => null),
  DateTimePickerAndroid: { open: jest.fn() },
}))
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
jest.mock('@/components/Icon', () => ({ Icon: () => null }))

const originalPlatform = Platform.OS
afterEach(() => {
  Platform.OS = originalPlatform
  jest.clearAllMocks()
})

it('opens the Android calendar with the stored local date and saves the selected calendar day', async () => {
  Platform.OS = 'android'
  const onChange = jest.fn()
  const { getByLabelText } = await render(
    <DateField value="2026-10-11" onChange={onChange} label="Start" placeholder="Select" />
  )
  await fireEvent.press(getByLabelText('Start'))
  const options = jest.mocked(DateTimePickerAndroid.open).mock.calls[0][0]
  expect(options.value.getFullYear()).toBe(2026)
  expect(options.value.getMonth()).toBe(9)
  expect(options.value.getDate()).toBe(11)
  options.onValueChange?.({ nativeEvent: { timestamp: 0, utcOffset: 0 } }, new Date(2026, 9, 12))
  expect(onChange).toHaveBeenCalledWith('2026-10-12')
})

it('keeps the saved date when the Android picker is dismissed', async () => {
  Platform.OS = 'android'
  const onChange = jest.fn()
  const { getByLabelText } = await render(
    <DateField value="2026-10-11" onChange={onChange} label="Start" placeholder="Select" />
  )
  await fireEvent.press(getByLabelText('Start'))
  const options = jest.mocked(DateTimePickerAndroid.open).mock.calls[0][0]
  options.onDismiss?.()
  expect(onChange).not.toHaveBeenCalled()
})

it('allows clearing the optional end date', async () => {
  Platform.OS = 'android'
  const onChange = jest.fn()
  const { getByLabelText } = await render(
    <DateField value="2026-10-11" onChange={onChange} label="End" placeholder="Optional" optional />
  )
  await fireEvent.press(getByLabelText('newPost.trip.clearEndDate'))
  expect(onChange).toHaveBeenCalledWith('')
})

it('confirms an iOS draft only when Done is pressed', async () => {
  Platform.OS = 'ios'
  const onChange = jest.fn()
  const screen = await render(<DateField value="2026-10-11" onChange={onChange} label="Start" placeholder="Select" />)
  await fireEvent.press(screen.getByLabelText('Start'))
  const props = jest.mocked(DateTimePicker).mock.calls.at(-1)![0]
  expect(props.value.getDate()).toBe(11)
  await act(() => props.onValueChange?.({ nativeEvent: { timestamp: 0, utcOffset: 0 } }, new Date(2026, 9, 12)))
  expect(onChange).not.toHaveBeenCalled()
  await fireEvent.press(screen.getByText('common.done'))
  expect(onChange).toHaveBeenCalledWith('2026-10-12')
})

it('discards an iOS draft on Cancel and reopens with the saved date', async () => {
  Platform.OS = 'ios'
  const onChange = jest.fn()
  const screen = await render(<DateField value="2026-10-11" onChange={onChange} label="Start" placeholder="Select" />)
  await fireEvent.press(screen.getByLabelText('Start'))
  const props = jest.mocked(DateTimePicker).mock.calls.at(-1)![0]
  await act(() => props.onValueChange?.({ nativeEvent: { timestamp: 0, utcOffset: 0 } }, new Date(2026, 9, 12)))
  await fireEvent.press(screen.getByText('common.cancel'))
  expect(onChange).not.toHaveBeenCalled()
  await fireEvent.press(screen.getByLabelText('Start'))
  expect(jest.mocked(DateTimePicker).mock.calls.at(-1)![0].value.getDate()).toBe(11)
})

it('opens an empty field with a valid date without saving automatically', async () => {
  Platform.OS = 'android'
  const onChange = jest.fn()
  const screen = await render(<DateField value="" onChange={onChange} label="End" placeholder="Optional" optional />)
  await fireEvent.press(screen.getByLabelText('End'))
  expect(Number.isNaN(jest.mocked(DateTimePickerAndroid.open).mock.calls[0][0].value.getTime())).toBe(false)
  expect(screen.queryByLabelText('newPost.trip.clearEndDate')).toBeNull()
  expect(onChange).not.toHaveBeenCalled()
})

it('displays the date in the device locale while keeping the API date unchanged', async () => {
  Platform.OS = 'android'
  const onChange = jest.fn()
  const screen = await render(<DateField value="2026-10-11" onChange={onChange} label="Start" placeholder="Select" />)
  expect(screen.getByText('11/10/2026')).toBeTruthy()
  jest.mocked(getLocales).mockReturnValue([{ ...getLocales()[0], languageTag: 'nl-NL' }])
  await screen.rerender(<DateField value="2026-10-11" onChange={onChange} label="Start" placeholder="Select" />)
  expect(screen.getByText('11-10-2026')).toBeTruthy()
  jest.mocked(getLocales).mockReturnValue([{ ...getLocales()[0], languageTag: 'en-GB' }])
  expect(onChange).not.toHaveBeenCalled()
})

it('bounds the Android end date and rejects dates before the start', async () => {
  Platform.OS = 'android'
  const onChange = jest.fn()
  const screen = await render(
    <DateField value="" onChange={onChange} label="End" placeholder="Optional" minimumDate="2027-02-15" optional />
  )
  await fireEvent.press(screen.getByLabelText('End'))
  const options = jest.mocked(DateTimePickerAndroid.open).mock.calls[0][0]
  expect(options.minimumDate).toEqual(new Date(2027, 1, 15, 12))
  expect(options.value.getTime()).toBeGreaterThanOrEqual(options.minimumDate!.getTime())
  options.onValueChange?.({ nativeEvent: { timestamp: 0, utcOffset: 0 } }, new Date(2027, 1, 14))
  expect(onChange).not.toHaveBeenCalled()
  options.onValueChange?.({ nativeEvent: { timestamp: 0, utcOffset: 0 } }, new Date(2027, 1, 15))
  expect(onChange).toHaveBeenCalledWith('2027-02-15')
})

it('applies the same minimum to the iOS calendar', async () => {
  Platform.OS = 'ios'
  const screen = await render(
    <DateField value="2026-10-11" onChange={jest.fn()} label="End" placeholder="Optional" minimumDate="2026-10-12" />
  )
  await fireEvent.press(screen.getByLabelText('End'))
  const props = jest.mocked(DateTimePicker).mock.calls.at(-1)![0]
  expect(props.minimumDate).toEqual(new Date(2026, 9, 12, 12))
  expect(props.value).toEqual(props.minimumDate)
})
