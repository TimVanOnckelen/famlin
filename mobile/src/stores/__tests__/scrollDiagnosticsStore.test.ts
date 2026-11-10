import { useScrollDiagnosticsStore } from '@/stores/scrollDiagnosticsStore'

it('starts switched off and can be switched on and off', () => {
  expect(useScrollDiagnosticsStore.getState().enabled).toBe(false)
  useScrollDiagnosticsStore.getState().setEnabled(true)
  expect(useScrollDiagnosticsStore.getState().enabled).toBe(true)
  useScrollDiagnosticsStore.getState().setEnabled(false)
  expect(useScrollDiagnosticsStore.getState().enabled).toBe(false)
})
