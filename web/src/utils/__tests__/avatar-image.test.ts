import { getAvatarCrop, prepareAvatar } from '../avatar-image'

afterEach(() => vi.restoreAllMocks())

it('crops landscape/portrait images within bounds and clamps the controls', () => {
  expect(getAvatarCrop(4000, 3000, { zoom: 1, x: 0, y: 0 })).toEqual({ x: 500, y: 0, size: 3000 })
  expect(getAvatarCrop(3000, 4000, { zoom: 1, x: 0, y: 0 })).toEqual({ x: 0, y: 500, size: 3000 })
  expect(getAvatarCrop(4000, 3000, { zoom: 2, x: 10, y: -10 })).toEqual({ x: 2500, y: 0, size: 1500 })
})

it.each([
  [4000, 3000, 512],
  [128, 200, 128],
])('encodes %dx%d input as a bounded %dpx JPEG', async (width, height, output) => {
  const drawImage = vi.fn()
  const fillRect = vi.fn()
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage,
    fillRect,
  } as unknown as CanvasRenderingContext2D)
  const toBlob = vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (
    this: HTMLCanvasElement,
    callback
  ) {
    expect(this.width).toBe(output)
    expect(this.height).toBe(output)
    callback(new Blob(['jpeg bytes'], { type: 'image/jpeg' }))
  })
  const image = document.createElement('img')
  Object.defineProperties(image, { naturalWidth: { value: width }, naturalHeight: { value: height } })
  const file = await prepareAvatar(image, { zoom: 1, x: 0, y: 0 })
  expect(file.name).toBe('avatar.jpg')
  expect(file.type).toBe('image/jpeg')
  expect(toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/jpeg', 0.8)
  expect(drawImage).toHaveBeenCalledWith(
    image,
    (width - Math.min(width, height)) / 2,
    (height - Math.min(width, height)) / 2,
    Math.min(width, height),
    Math.min(width, height),
    0,
    0,
    output,
    output
  )
  expect(fillRect).toHaveBeenCalledWith(0, 0, output, output)
})

it('rejects encoder failures instead of uploading the original file', async () => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage() {},
    fillRect() {},
  } as unknown as CanvasRenderingContext2D)
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => callback(null))
  const image = document.createElement('img')
  Object.defineProperties(image, { naturalWidth: { value: 4000 }, naturalHeight: { value: 3000 } })
  await expect(prepareAvatar(image, { zoom: 1, x: 0, y: 0 })).rejects.toThrow('Image encoding failed')
})
