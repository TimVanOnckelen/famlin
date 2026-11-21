// Reads a video's length from its metadata in the browser. Resolves 0 when
// the browser can't tell (unsupported codec, streaming WebM without a
// duration), so a video is only ever rejected for a duration we actually read.
export function videoDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    const video = document.createElement('video')
    const url = URL.createObjectURL(file)
    const done = (seconds: number) => {
      URL.revokeObjectURL(url)
      resolve(Number.isFinite(seconds) ? seconds : 0)
    }
    video.preload = 'metadata'
    video.onloadedmetadata = () => done(video.duration)
    video.onerror = () => done(0)
    video.src = url
  })
}
