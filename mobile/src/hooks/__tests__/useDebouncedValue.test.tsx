import { act, renderHook } from '@testing-library/react-native'
import { useDebouncedValue } from '../useDebouncedValue'

describe('useDebouncedValue', () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())

  it('settles after the delay and resets on every change', async () => {
    const { result, rerender } = await renderHook((props: { v: string }) => useDebouncedValue(props.v), {
      initialProps: { v: 'a' },
    })
    expect(result.current).toBe('a')
    await rerender({ v: 'ab' })
    await act(async () => {
      jest.advanceTimersByTime(200)
    })
    await rerender({ v: 'abc' })
    await act(async () => {
      jest.advanceTimersByTime(200)
    })
    expect(result.current).toBe('a')
    await act(async () => {
      jest.advanceTimersByTime(100)
    })
    expect(result.current).toBe('abc')
  })

  it('passes an empty value through at once', async () => {
    const { result, rerender } = await renderHook((props: { v: string }) => useDebouncedValue(props.v), {
      initialProps: { v: 'lasagna' },
    })
    await rerender({ v: '' })
    expect(result.current).toBe('')
  })
})
