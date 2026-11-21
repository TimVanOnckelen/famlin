import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { fetchServerInfo, resolveServerLimits } from '@famlin/api-client'
import { groupLivePhotoFiles, type PickedAttachment } from '@/utils/livePhotos'
import { videoDuration } from '@/utils/videoDuration'

const formatDuration = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`

// The server's attachment/video/upload limits (issue #436) plus a screen for
// picked files, shared by every composer that uploads photos/videos. A Live
// Photo (still + motion clip) counts as one attachment, as on the server.
export function useMediaLimits() {
  const { t } = useTranslation()
  const { data } = useQuery({ queryKey: ['server-info'], queryFn: fetchServerInfo })
  const limits = resolveServerLimits(data)
  const [error, setError] = useState<string | null>(null)
  const tooMany = () => t('media.limits.tooMany', { max: limits.maxAttachments })

  // Drops files over the size or video-length limit and whatever doesn't fit
  // next to `used` attachments, reporting the last reason in `error`. Pass
  // `pairLivePhotos: false` where uploads skip the server's Live Photo pairing
  // (no upload session), so each file is its own URL and counts separately.
  async function screen(files: File[], used: number, { pairLivePhotos = true } = {}): Promise<File[]> {
    let problem: string | null = null
    const accepted: File[] = []
    for (const file of files) {
      if (file.size > limits.maxUploadSizeMb * 1024 * 1024) {
        problem = t('media.limits.fileTooLarge', { name: file.name, max: limits.maxUploadSizeMb })
      } else if (file.type.startsWith('video/') && (await videoDuration(file)) > limits.maxVideoDurationSeconds) {
        problem = t('media.limits.videoTooLong', {
          name: file.name,
          max: formatDuration(limits.maxVideoDurationSeconds),
        })
      } else accepted.push(file)
    }
    const room = Math.max(0, limits.maxAttachments - used)
    const groups: PickedAttachment[] = pairLivePhotos
      ? groupLivePhotoFiles(accepted)
      : accepted.map((file) => ({ file }))
    if (groups.length > room) problem = tooMany()
    setError(problem)
    const kept = new Set(groups.slice(0, room).flatMap((group) => [group.file, group.motionFile]))
    return accepted.filter((file) => kept.has(file))
  }

  return { ...limits, error, setError, tooMany, screen }
}
