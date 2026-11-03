import 'react-native-gesture-handler/jestSetup'
import React from 'react'
import { act, render } from '@testing-library/react-native'
import { Pressable, Text } from 'react-native'
import { State, type PanGesture, type GestureTouchEvent, type GestureStateManager } from 'react-native-gesture-handler'
import { fireGestureHandler, getByGestureTestId } from 'react-native-gesture-handler/jest-utils'
import { SwipeToDismiss } from '../SwipeToDismiss'
import { withTiming } from 'react-native-reanimated'
import * as Reanimated from 'react-native-reanimated'

// Jest factories load the official native-library mocks synchronously.
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('react-native-worklets', () => require('react-native-worklets/src/mock'))
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('react-native-reanimated', () => require('react-native-reanimated/mock'))

async function mount(disabled = false, topInset = 0, bottomInset = 0) {
  const onClose = jest.fn()
  const onActiveChange = jest.fn()
  const onTap = jest.fn()
  const screen = await render(
    <SwipeToDismiss
      disabled={disabled}
      onClose={onClose}
      onActiveChange={onActiveChange}
      topInset={topInset}
      bottomInset={bottomInset}
    >
      <Pressable onPress={onTap}>
        <Text>Next story</Text>
      </Pressable>
    </SwipeToDismiss>
  )
  return { screen, onClose, onActiveChange, onTap }
}

it('uses a native downward pan with direction and multitouch limits', async () => {
  await mount()
  expect(getByGestureTestId('swipe-dismiss').config).toMatchObject({
    activeOffsetYEnd: 10,
    failOffsetYStart: -10,
    failOffsetXStart: -20,
    failOffsetXEnd: 20,
    maxPointers: 1,
  })
})

it.each([
  { translationY: 200, velocityY: 0 },
  { translationY: 45, velocityY: 1100 },
])('closes after a native long drag or flick (%j)', async (event) => {
  const { onClose, onActiveChange, onTap } = await mount()
  await act(() =>
    fireGestureHandler<PanGesture>(getByGestureTestId('swipe-dismiss'), [
      { state: State.BEGAN },
      { state: State.ACTIVE, translationY: 0, translationX: 0 },
      { state: State.ACTIVE, ...event },
      { state: State.END, ...event },
    ])
  )
  expect(onClose).toHaveBeenCalledTimes(1)
  expect(onActiveChange).toHaveBeenCalledWith(true)
  expect(onActiveChange).not.toHaveBeenCalledWith(false)
  expect(onTap).not.toHaveBeenCalled()
})

it.each([
  { translationY: 40, velocityY: 0 },
  { translationY: 200, velocityY: -800 },
])('restores a short or reversed gesture (%j)', async (event) => {
  const { onClose, onActiveChange } = await mount()
  await act(() =>
    fireGestureHandler<PanGesture>(getByGestureTestId('swipe-dismiss'), [
      { state: State.BEGAN },
      { state: State.ACTIVE, translationY: 0, translationX: 0 },
      { state: State.ACTIVE, ...event },
      { state: State.END, ...event },
    ])
  )
  expect(onClose).not.toHaveBeenCalled()
  expect(onActiveChange.mock.calls).toEqual([[true], [false]])
})

it('restores an active gesture cancelled by Android', async () => {
  const { onClose, onActiveChange } = await mount()
  await act(() =>
    fireGestureHandler<PanGesture>(getByGestureTestId('swipe-dismiss'), [
      { state: State.BEGAN },
      { state: State.ACTIVE, translationY: 80 },
      { state: State.CANCELLED },
    ])
  )
  expect(onClose).not.toHaveBeenCalled()
  expect(onActiveChange).toHaveBeenLastCalledWith(false)
})

it('leaves reply and insights interactions alone while disabled', async () => {
  const { onClose, onActiveChange } = await mount(true)
  await act(() =>
    fireGestureHandler<PanGesture>(getByGestureTestId('swipe-dismiss'), [
      { state: State.BEGAN },
      { state: State.ACTIVE, translationY: 200 },
      { state: State.END, translationY: 200 },
    ])
  )
  expect(onClose).not.toHaveBeenCalled()
  expect(onActiveChange).not.toHaveBeenCalled()
})

it.each([
  [90, 180, 40, true],
  [90, 100, 40, true],
  [90, 180, 200, false],
  [90, 100, 200, false],
  [90, 180, 10000, true],
  [90, 100, 10000, true],
])('respects the control regions for each viewer (%i, %i, %i)', async (top, bottom, y, excluded) => {
  await mount(false, top, bottom)
  const manager: GestureStateManager = {
    handlerTag: 1,
    begin: jest.fn(),
    activate: jest.fn(),
    fail: jest.fn(),
    end: jest.fn(),
  }
  const event = { allTouches: [{ y }] } as GestureTouchEvent
  await act(() => getByGestureTestId('swipe-dismiss').handlers.onTouchesDown?.(event, manager))
  expect(manager.fail).toHaveBeenCalledTimes(excluded ? 1 : 0)
})

it('returns within 180ms and accepts a new swipe before the return completes', async () => {
  const timing = jest.spyOn(Reanimated, 'withTiming').mockImplementation((value, _config, complete) => {
    // Leave the return unfinished; finish the exit animation normally.
    if (value !== 0) complete?.(true)
    return value
  })
  try {
    const { onClose, onActiveChange } = await mount()
    const pan = getByGestureTestId('swipe-dismiss')
    await act(() =>
      fireGestureHandler<PanGesture>(pan, [
        { state: State.BEGAN },
        { state: State.ACTIVE, translationY: 0, translationX: 0 },
        { state: State.ACTIVE, translationY: 60 },
        { state: State.END, translationY: 60, velocityY: 0 },
      ])
    )
    expect(withTiming).toHaveBeenCalledWith(0, expect.objectContaining({ duration: 180 }), expect.any(Function))
    expect(onActiveChange).not.toHaveBeenCalledWith(false)
    const manager: GestureStateManager = {
      handlerTag: 1,
      begin: jest.fn(),
      activate: jest.fn(),
      fail: jest.fn(),
      end: jest.fn(),
    }
    await act(() => pan.handlers.onTouchesDown?.({ allTouches: [{ y: 200 }] } as GestureTouchEvent, manager))
    expect(manager.fail).not.toHaveBeenCalled()
    await act(() =>
      fireGestureHandler<PanGesture>(pan, [
        { state: State.BEGAN },
        { state: State.ACTIVE, translationY: 0, translationX: 0 },
        { state: State.ACTIVE, translationY: 200 },
        { state: State.END, translationY: 200, velocityY: 0 },
      ])
    )
    expect(onClose).toHaveBeenCalledTimes(1)
  } finally {
    timing.mockRestore()
  }
})
