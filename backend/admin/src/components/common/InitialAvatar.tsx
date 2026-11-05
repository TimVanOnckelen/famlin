import { useCallback, useSyncExternalStore } from 'react'
import { AvatarImageCache } from '@/lib/avatar-image-cache'
import { api } from '@/api/client'
import { UserAvatar } from '@famlin/ui/common/user-avatar'

const imageCache = new AvatarImageCache(
  async (url) => {
    const src = await api.fetchUploadObjectUrl(url)
    if (!src) return null
    try {
      const image = new Image()
      image.src = src
      await image.decode()
      return src
    } catch {
      URL.revokeObjectURL(src)
      return null
    }
  },
  (src) => URL.revokeObjectURL(src)
)
const noop = () => {}

export function InitialAvatar({
  name,
  avatarUrl,
  className,
}: {
  name: string
  avatarUrl?: string | null
  className?: string
}) {
  const isUpload = Boolean(
    avatarUrl?.startsWith('/uploads/') || avatarUrl?.startsWith(`${window.location.origin}/uploads/`)
  )
  // A new session must never reuse a previous session's protected images.
  const cacheKey = `${localStorage.getItem('famlin_admin_token') ?? ''}\0${avatarUrl ?? ''}`
  const subscribe = useCallback(
    (notify: () => void) => {
      if (!avatarUrl || !isUpload) return noop
      return imageCache.subscribe(cacheKey, avatarUrl, notify)
    },
    [avatarUrl, isUpload, cacheKey]
  )
  const getSnapshot = useCallback(() => imageCache.getSnapshot(cacheKey), [cacheKey])
  const cachedSrc = useSyncExternalStore(subscribe, getSnapshot)
  const src = isUpload ? cachedSrc : (avatarUrl ?? undefined)
  return <UserAvatar name={name} src={src} className={className} />
}
