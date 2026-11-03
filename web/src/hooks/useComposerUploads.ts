import { useEffect, useRef, useState } from 'react'
import { uploadFilesInSession, uploadKey, type UploadSessionMedia } from '@famlin/api-client'
import { randomUUID } from '@/utils/uuid'
import { groupLivePhotoFiles } from '@/utils/livePhotos'

export interface ComposerUpload {
  id: number
  file: File
  previewUrl: string
  url?: string
  motionId?: number
  pending?: boolean
  processing?: UploadSessionMedia
}

// Shared by album contributions and comments: upload on selection, then
// submit stable server URLs without re-uploading on a failed publish.
export function useComposerUploads(limit: number) {
  const [snapshot, setSnapshot] = useState(() => ({
    session: randomUUID(),
    items: [] as ComposerUpload[],
    media: [] as UploadSessionMedia[],
    excluded: new Set<string>(),
    nextId: 0,
    requests: 0,
    error: false,
  }))
  const state = useRef({ ...snapshot, items: [...snapshot.items], media: [...snapshot.media] })
  const mounted = useRef(true)
  const update = () => {
    if (mounted.current) {
      const current = state.current
      setSnapshot({ ...current, items: current.items.map((item) => ({ ...item })), media: [...current.media] })
    }
  }
  useEffect(() => {
    mounted.current = true
    const current = state.current
    return () => {
      mounted.current = false
      current.items.forEach((item) => URL.revokeObjectURL(item.previewUrl))
    }
  }, [])

  function merge(incoming: UploadSessionMedia[] = []) {
    const current = state.current
    const merged = new Map(current.media.map((item) => [item.url, item]))
    for (const item of incoming) {
      if (merged.get(item.url)?.kind !== 'livePhoto' || item.kind === 'livePhoto') merged.set(item.url, item)
    }
    current.media = [...merged.values()].filter(
      (item) =>
        !current.excluded.has(uploadKey(item.url) ?? '') && !current.excluded.has(uploadKey(item.videoUrl ?? '') ?? '')
    )
  }
  function exclude(url: string) {
    const key = uploadKey(url)
    if (key) state.current.excluded.add(key)
  }
  async function reconcile() {
    const current = state.current
    const response = await uploadFilesInSession([], current.session, [...current.excluded])
    merge(response.sessionMedia)
  }
  async function upload(batch: ComposerUpload[]) {
    const current = state.current
    current.requests++
    current.error = false
    update()
    try {
      const response = await uploadFilesInSession(
        batch.map((item) => item.file),
        current.session,
        [...current.excluded]
      )
      if (response.urls.length !== batch.length) throw new Error('Incomplete upload response')
      let removed = false
      batch.forEach((item, index) => {
        const active = current.items.find((entry) => entry.id === item.id)
        if (active) {
          active.url = response.urls[index]
          URL.revokeObjectURL(active.previewUrl)
          active.previewUrl = ''
        } else {
          exclude(response.urls[index])
          removed = true
        }
      })
      merge(response.sessionMedia)
      if (removed) await reconcile()
    } catch {
      current.error = true
    } finally {
      current.requests--
      if (!current.requests && current.items.some((item) => !item.url)) current.error = true
      update()
    }
  }
  async function add(files: File[]) {
    const current = state.current
    const batch = files.slice(0, Math.max(0, limit - current.items.length)).map((file) => ({
      id: current.nextId++,
      file,
      previewUrl: URL.createObjectURL(file),
    }))
    if (!batch.length) return
    current.items.push(...batch)
    await upload(batch)
  }
  async function retry() {
    const current = state.current
    if (current.requests) return
    const failed = current.items.filter((item) => !item.url)
    if (failed.length) {
      await upload(failed)
      return
    }
    current.requests++
    current.error = false
    update()
    try {
      await reconcile()
    } catch {
      current.error = true
    } finally {
      current.requests--
      update()
    }
  }
  const current = snapshot
  const candidates = groupLivePhotoFiles(current.items.map((item) => item.file))
  const displayed = current.items.flatMap((item): ComposerUpload[] => {
    const linked = current.media.find((entry) => entry.kind === 'livePhoto' && entry.url === item.url)
    if (linked) return [{ ...item, motionId: current.items.find((entry) => entry.url === linked.videoUrl)?.id }]
    if (
      current.media.some(
        (entry) =>
          entry.kind === 'livePhoto' &&
          entry.videoUrl === item.url &&
          current.items.some((photo) => photo.url === entry.url)
      )
    )
      return []
    const candidate = candidates.find((pair) => pair.file === item.file || pair.motionFile === item.file)
    if (candidate?.motionFile) {
      const photo = current.items.find((entry) => entry.file === candidate.file)!
      const motion = current.items.find((entry) => entry.file === candidate.motionFile)!
      if (!photo.url || !motion.url) return item.id === photo.id ? [{ ...photo, motionId: motion.id }] : []
    }
    return [item]
  })
  async function remove(item: ComposerUpload) {
    const current = state.current
    const removed = current.items.filter((entry) => entry.id === item.id || entry.id === item.motionId)
    current.items = current.items.filter((entry) => !removed.includes(entry))
    removed.forEach((entry) => {
      URL.revokeObjectURL(entry.previewUrl)
      if (entry.url) exclude(entry.url)
    })
    if (!current.requests && current.items.every((entry) => !!entry.url) && !current.excluded.size)
      current.error = false
    if (!removed.some((entry) => entry.url)) {
      update()
      return
    }
    current.requests++
    update()
    try {
      await reconcile()
      current.error = current.items.some((item) => !item.url)
    } catch {
      current.error = true
    } finally {
      current.requests--
      update()
    }
  }
  function clear() {
    const current = state.current
    current.items.forEach((item) => URL.revokeObjectURL(item.previewUrl))
    current.items = []
    current.media = []
    current.excluded.clear()
    current.error = false
    current.session = randomUUID()
    update()
  }
  return {
    items: displayed.map((item) => ({
      ...item,
      processing: current.media.find((media) => media.url === item.url),
      pending: item.motionId !== undefined && current.items.some((entry) => entry.id === item.motionId && !entry.url),
    })),
    count: current.items.length,
    uploading: current.requests > 0,
    incomplete: current.items.some((item) => !item.url),
    error: current.error,
    urls: displayed.flatMap((item) => (item.url ? [item.url] : [])),
    add,
    remove,
    clear,
    retry,
  }
}
