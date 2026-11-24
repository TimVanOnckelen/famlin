import type { E2eMessageContentV1 } from '@famlin/api-client'

// Decrypted messages by message id, so scrolling a conversation never decrypts
// the same message twice and reply quotes can be resolved from what is already
// open. Memory only: plaintext is never written to disk (attachments are the
// one exception, see attachments.ts, and they go to the cache directory).
const contents = new Map<string, E2eMessageContentV1>()

export function getCachedContent(messageId: string): E2eMessageContentV1 | undefined {
  return contents.get(messageId)
}

export function setCachedContent(messageId: string, content: E2eMessageContentV1) {
  contents.set(messageId, content)
}

export function clearE2eCache() {
  contents.clear()
}
