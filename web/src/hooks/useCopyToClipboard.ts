import { useCallback, useState } from 'react'

// "Copy" button state for show-once secrets (API tokens, the calendar feed
// URL). `copy` resolves false when clipboard access is denied (insecure
// origin, permissions), so the caller can fall back to selecting the text;
// `reset` clears the "Copied" label when a new secret replaces the old one.
export function useCopyToClipboard() {
  const [copied, setCopied] = useState(false)

  const copy = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      return true
    } catch {
      return false
    }
  }, [])

  const reset = useCallback(() => setCopied(false), [])

  return { copied, copy, reset }
}
