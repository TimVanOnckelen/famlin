import type { Upload } from '@prisma/client'
import { prisma } from '../db.js'

export function shapeUploadProcessing(upload: (Upload & { motionUpload: Upload | null }) | null) {
  const motion = upload?.motionUpload
  const statuses = [upload?.processingStatus ?? 'ready', motion?.processingStatus]
  const status = statuses.includes('failed')
    ? ('failed' as const)
    : statuses.includes('processing')
      ? ('processing' as const)
      : statuses.includes('queued')
        ? ('queued' as const)
        : ('ready' as const)
  return {
    status,
    url: upload?.mediaUrl ?? null,
    thumbnailUrl: upload?.thumbnailUrl ?? null,
    kind: motion
      ? ('livePhoto' as const)
      : upload?.mediaKind === 'video' || /\.(mp4|mov|m4v|webm)$/i.test(upload?.mediaUrl ?? '')
        ? ('video' as const)
        : ('image' as const),
    videoUrl: motion?.mediaUrl ?? null,
  }
}

function assetKey(url: string) {
  return /^\/uploads\/([0-9a-f-]{36})(?:-thumbnail)?\.[a-z0-9]+$/i.exec(url)?.[1]
}

// Run after type enrichment so album/trip collage media shares the batch.
export async function attachUploadProcessing<T extends { uploadedAssetUrls: string[]; typeData?: unknown }>(
  posts: T[]
) {
  const urlsFor = (post: T) => {
    const media = post as T & { album?: { collagePhotoUrls?: string[] }; trip?: { collagePhotoUrls?: string[] } }
    const cover = (post.typeData as { coverPhotoUrl?: string } | null)?.coverPhotoUrl
    return [
      ...post.uploadedAssetUrls,
      ...(cover ? [cover] : []),
      ...(media.album?.collagePhotoUrls ?? []),
      ...(media.trip?.collagePhotoUrls ?? []),
    ]
  }
  const keysByPost = posts.map((post) => [...new Set(urlsFor(post).flatMap((url) => assetKey(url) ?? []))])
  const keys = [...new Set(keysByPost.flat())]
  const uploads = keys.length
    ? await prisma.upload.findMany({ where: { assetKey: { in: keys } }, include: { motionUpload: true } })
    : []
  const byKey = new Map(uploads.map((upload) => [upload.assetKey, shapeUploadProcessing(upload)]))
  return posts.map((post, index) => ({
    ...post,
    uploadProcessing: Object.fromEntries(
      keysByPost[index].map((key) => [key, byKey.get(key) ?? shapeUploadProcessing(null)])
    ),
  }))
}
