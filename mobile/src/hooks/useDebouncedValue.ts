import { useEffect, useState } from 'react'

// A search box's value, settled: it follows `value` once typing has paused
// for `delayMs`, so a request isn't fired on every keystroke. An empty value
// is passed through immediately — clearing a search (or resetting it when
// switching family) shouldn't wait out the delay first.
export function useDebouncedValue(value: string, delayMs = 300): string {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    if (!value) return
    const timer = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, delayMs])
  return value ? debounced : ''
}
