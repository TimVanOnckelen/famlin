import { useSyncExternalStore } from 'react'
import { tokens } from '@famlin/design-tokens'

/**
 * Matches the `max-desktop:` Tailwind variant: below the `desktop` breakpoint
 * token, in rem like the generated CSS so both switch at the same width even
 * with a non-default browser font size.
 */
export const COMPACT_MEDIA_QUERY = `(width < ${tokens.breakpoint.desktop / 16}rem)`

function subscribe(onChange: () => void) {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {}
  const query = window.matchMedia(COMPACT_MEDIA_QUERY)
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}

function getSnapshot() {
  return typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(COMPACT_MEDIA_QUERY).matches
}

/** True on compact (≤720px) screens. Use only where markup must differ; prefer `max-desktop:` styles. */
export function useCompactLayout() {
  return useSyncExternalStore(subscribe, getSnapshot, () => false)
}
