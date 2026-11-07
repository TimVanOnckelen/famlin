import { fetchUploadProcessing, getUploadUrl, uploadFiles, uploadKey } from '@famlin/api-client'

export function isHeicImage(file: File) {
  return /\.(heic|heif)$/i.test(file.name) || /^image\/hei[cf](?:-sequence)?$/i.test(file.type)
}

function waitForPoll(signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    signal.throwIfAborted()
    const onAbort = () => {
      clearTimeout(timer)
      reject(signal.reason)
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, 2000)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

// The source remains unbound; the profile only receives the final crop.
// Reuse the normal conversion queue; never set the original as the profile photo.
export async function convertAvatarForPreview(file: File, signal: AbortSignal): Promise<string> {
  signal.throwIfAborted()
  const [url] = await uploadFiles([file])
  signal.throwIfAborted()
  const key = url && uploadKey(url)
  if (!key) throw new Error('Missing upload key')
  const deadline = Date.now() + 120_000
  while (Date.now() < deadline) {
    const result = await fetchUploadProcessing(key)
    signal.throwIfAborted()
    if (result.status === 'failed') throw new Error('Image conversion failed')
    if (result.status === 'ready' && result.url) return getUploadUrl(result.url)
    await waitForPoll(signal)
  }
  throw new Error('Image conversion timed out')
}
