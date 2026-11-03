import { Directory, File, Paths } from 'expo-file-system'
import type { PendingShare } from '@/stores/pendingShareStore'
import {
  IncomingSharedFile,
  SharedMediaItem,
  extensionForMimeType,
  normalizeMimeType,
  screenSharedFiles,
} from '@/utils/sharedMedia'

/**
 * Turns the files of an OS share into a PendingShare: screens out what the
 * composer wouldn't accept, then copies each remaining file into the app's own
 * cache directory straight away. An Android `content://` grant (or an iOS
 * share-extension file) can stop being readable once the share intent is
 * gone, and the share may have to wait out a login first.
 */
export async function receiveSharedFiles(files: IncomingSharedFile[]): Promise<PendingShare> {
  const { accepted, unsupported, tooLong } = screenSharedFiles(files)
  const share: PendingShare = { items: [], unsupported, tooLong }
  if (accepted.length === 0) return share

  const directory = new Directory(Paths.cache, 'shared')
  directory.create({ idempotent: true, intermediates: true })
  const batch = Date.now()

  for (const [index, file] of accepted.entries()) {
    const mimeType = normalizeMimeType(file.mimeType)
    const extension = extensionForMimeType(mimeType)
    try {
      const destination = new File(directory, `share-${batch}-${index}.${extension}`)
      await new File(file.path).copy(destination)
      const item: SharedMediaItem = {
        uri: destination.uri,
        mimeType,
        fileName: file.fileName || `${mimeType.startsWith('video/') ? 'video' : 'photo'}-${index}.${extension}`,
        isVideo: mimeType.startsWith('video/'),
        width: file.width,
        height: file.height,
      }
      share.items.push(item)
    } catch (err) {
      console.warn('Could not copy shared file:', err)
      share.unsupported++
    }
  }
  return share
}
