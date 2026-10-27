import { create } from 'zustand'
import type { SharedMediaItem } from '@/utils/sharedMedia'

/** Photos/videos shared into Famlin from the OS share sheet, waiting for the
 * new-post composer to pick them up. */
export interface PendingShare {
  items: SharedMediaItem[]
  /** Files dropped on arrival: an unsupported format, or unreadable. */
  unsupported: number
  /** Videos dropped on arrival for exceeding the picker's duration limit. */
  tooLong: number
}

interface PendingShareState {
  share: PendingShare | null
  /** Queues a share. A second share arriving before the first is consumed is
   * appended to it, so nothing is lost; the composer applies the cap. */
  addShare: (share: PendingShare) => void
  /** Returns the pending share and clears it, so it's consumed exactly once. */
  takeShare: () => PendingShare | null
  clear: () => void
}

// A store rather than navigation params (issue #199): a share has to survive
// the login detour and reach a composer that's already open.
export const usePendingShareStore = create<PendingShareState>((set, get) => ({
  share: null,

  addShare: (share) => {
    const current = get().share
    set({
      share: current
        ? {
            items: [...current.items, ...share.items],
            unsupported: current.unsupported + share.unsupported,
            tooLong: current.tooLong + share.tooLong,
          }
        : share,
    })
  },

  takeShare: () => {
    const share = get().share
    if (share) set({ share: null })
    return share
  },

  clear: () => set({ share: null }),
}))
