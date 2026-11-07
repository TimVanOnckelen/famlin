type Entry = {
  src?: string
  pending: boolean
  failedAt: number
  listeners: Set<() => void>
}

// Retain recently used photos across page changes and StrictMode remounts.
// Active and in-flight entries are never evicted or revoked.
export class AvatarImageCache {
  private entries = new Map<string, Entry>()

  constructor(
    private load: (url: string) => Promise<string | null>,
    private revoke: (src: string) => void,
    private limit = 128
  ) {}

  getSnapshot(key: string): string | undefined {
    return this.entries.get(key)?.src
  }

  subscribe(key: string, url: string, listener: () => void): () => void {
    let entry = this.entries.get(key)
    if (!entry) {
      entry = { pending: false, failedAt: 0, listeners: new Set() }
    }
    // Map insertion order doubles as the least-recently-used queue.
    this.entries.delete(key)
    this.entries.set(key, entry)
    entry.listeners.add(listener)
    if (!entry.src && !entry.pending && (!entry.failedAt || Date.now() - entry.failedAt >= 30_000)) {
      entry.pending = true
      const current = entry
      void this.load(url)
        .catch(() => null)
        .then((src) => {
          current.pending = false
          current.src = src ?? undefined
          current.failedAt = src ? 0 : Date.now()
          for (const notify of current.listeners) notify()
          this.prune()
        })
    }
    this.prune()
    return () => {
      entry.listeners.delete(listener)
      this.prune()
    }
  }

  private prune() {
    for (const [key, entry] of this.entries) {
      if (this.entries.size <= this.limit) break
      if (entry.listeners.size || entry.pending) continue
      this.entries.delete(key)
      if (entry.src) this.revoke(entry.src)
    }
  }
}
