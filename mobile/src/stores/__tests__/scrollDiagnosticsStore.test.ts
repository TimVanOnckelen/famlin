import { isScrollDiagnosticsBuild } from '@/stores/scrollDiagnosticsStore'

describe('isScrollDiagnosticsBuild', () => {
  it('keeps the diagnostics out of a store build', () => {
    expect(isScrollDiagnosticsBuild(false, undefined)).toBe(false)
    expect(isScrollDiagnosticsBuild(false, '')).toBe(false)
    expect(isScrollDiagnosticsBuild(false, '0')).toBe(false)
  })

  it('allows them in development and in a build made with the flag', () => {
    expect(isScrollDiagnosticsBuild(true, undefined)).toBe(true)
    expect(isScrollDiagnosticsBuild(false, '1')).toBe(true)
  })
})

describe('a build without the flag', () => {
  it('cannot switch the diagnostics on', () => {
    jest.isolateModules(() => {
      const dev = (globalThis as any).__DEV__
      ;(globalThis as any).__DEV__ = false
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { useScrollDiagnosticsStore } = require('@/stores/scrollDiagnosticsStore')
        useScrollDiagnosticsStore.getState().setEnabled(true)
        expect(useScrollDiagnosticsStore.getState().enabled).toBe(false)
      } finally {
        ;(globalThis as any).__DEV__ = dev
      }
    })
  })
})
