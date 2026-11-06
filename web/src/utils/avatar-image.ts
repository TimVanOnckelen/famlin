export interface AvatarCrop {
  zoom: number
  x: number
  y: number
}

export function getAvatarCrop(width: number, height: number, crop: AvatarCrop) {
  if (!(width > 0 && height > 0)) throw new Error('Invalid image dimensions')
  const zoom = Math.max(1, Math.min(3, crop.zoom))
  const size = Math.min(width, height) / zoom
  const clamp = (value: number) => Math.max(-1, Math.min(1, value))
  return {
    x: ((width - size) * (clamp(crop.x) + 1)) / 2,
    y: ((height - size) * (clamp(crop.y) + 1)) / 2,
    size,
  }
}

export async function prepareAvatar(image: HTMLImageElement, crop: AvatarCrop): Promise<File> {
  const area = getAvatarCrop(image.naturalWidth, image.naturalHeight, crop)
  const size = Math.max(1, Math.min(512, Math.floor(area.size)))
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas unavailable')
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  // JPEG has no alpha channel; give transparent input a predictable background.
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, size, size)
  context.drawImage(image, area.x, area.y, area.size, area.size, 0, 0, size, size)
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (result) => (result ? resolve(result) : reject(new Error('Image encoding failed'))),
      'image/jpeg',
      0.8
    )
  })
  return new File([blob], 'avatar.jpg', { type: 'image/jpeg' })
}
