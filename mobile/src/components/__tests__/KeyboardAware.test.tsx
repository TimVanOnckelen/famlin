import { render } from '@testing-library/react-native'
import { Platform, Text } from 'react-native'
import { KeyboardAwareScrollView, KeyboardAvoidingSafeAreaView } from '../KeyboardAware'

// Native keyboard events are outside Jest; expose the configured behavior
// while leaving the real ScrollView and its content rendering intact.
jest.mock('react-native/Libraries/Components/Keyboard/KeyboardAvoidingView', () => ({
  __esModule: true,
  default: ({ children, ...props }: Record<string, unknown>) => {
    const React = jest.requireActual('react')
    const { View } = jest.requireActual('react-native')
    return React.createElement(View, { ...props, testID: 'keyboard-avoiding' }, children)
  },
}))
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children, ...props }: Record<string, unknown>) => {
    const React = jest.requireActual('react')
    const { View } = jest.requireActual('react-native')
    return React.createElement(View, { ...props, testID: 'safe-area' }, children)
  },
}))

const originalOS = Platform.OS
afterEach(() => {
  Platform.OS = originalOS
})

test('iOS forms use native keyboard insets without a second keyboard adjustment', async () => {
  Platform.OS = 'ios'
  const { getByTestId, queryByTestId, getByText } = await render(
    <KeyboardAwareScrollView testID="form">
      <Text>Form</Text>
    </KeyboardAwareScrollView>
  )
  expect(queryByTestId('keyboard-avoiding')).toBeNull()
  expect(getByTestId('form').props.automaticallyAdjustKeyboardInsets).toBe(true)
  expect(getByTestId('form').props.keyboardShouldPersistTaps).toBe('handled')
  expect(getByText('Form')).toBeTruthy()
})

test('Android forms keep the height adjustment and scrollable content', async () => {
  Platform.OS = 'android'
  const { getByTestId, getByText } = await render(
    <KeyboardAwareScrollView testID="form">
      <Text>Form</Text>
    </KeyboardAwareScrollView>
  )
  expect(getByTestId('keyboard-avoiding').props.behavior).toBe('height')
  expect(getByTestId('form').props.keyboardShouldPersistTaps).toBe('handled')
  expect(getByText('Form')).toBeTruthy()
})

test.each(['ios', 'android'] as const)(
  'non-scrollable %s overlays preserve safe areas and touch pass-through',
  async (os) => {
    Platform.OS = os
    const { getByTestId, getByText } = await render(
      <KeyboardAvoidingSafeAreaView style={{ flex: 1 }} edges={['bottom']} pointerEvents="box-none">
        <Text>Reply</Text>
      </KeyboardAvoidingSafeAreaView>
    )
    expect(getByTestId('keyboard-avoiding').props.behavior).toBe(os === 'ios' ? 'padding' : 'height')
    expect(getByTestId('keyboard-avoiding').props.pointerEvents).toBe('box-none')
    expect(getByTestId('safe-area').props.edges).toEqual(['bottom'])
    expect(getByTestId('safe-area').props.pointerEvents).toBe('box-none')
    expect(getByText('Reply')).toBeTruthy()
  }
)
