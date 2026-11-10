import fs from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

// Generated illustrations for the demo's sample family. The seed has no photo
// files to ship (and real stock photos would bring licensing questions), so
// each picture is painted here from a few shapes — sky, hills, sea, sun,
// round objects — and written as an ordinary upload. Painted with raw pixels
// rather than SVG so it doesn't depend on the image's libvips being built
// with an SVG loader.
//
// Files are written only when missing, so re-running the seed is cheap; on a
// host with an ephemeral disk (Cloud Run) every cold start repaints them.

type RGB = [number, number, number]

interface Ridge {
  color: RGB
  // Height of the ridge line as a fraction of the image height, from the top.
  base: number
  amplitude: number
  frequency: number
  phase: number
}

interface Disc {
  x: number
  y: number
  r: number
  color: RGB
}

interface Band {
  top: number
  bottom: number
  from: RGB
  to: RGB
}

export interface Scene {
  sky: [RGB, RGB]
  sun?: Disc
  bands?: Band[]
  ridges?: Ridge[]
  discs?: Disc[]
  width?: number
  height?: number
}

function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}

function paint(scene: Scene): { data: Buffer; width: number; height: number } {
  const width = scene.width ?? 1200
  const height = scene.height ?? 900
  const data = Buffer.alloc(width * height * 3)
  const set = (x: number, y: number, c: RGB, alpha = 1) => {
    const i = (y * width + x) * 3
    data[i] = data[i] * (1 - alpha) + c[0] * alpha
    data[i + 1] = data[i + 1] * (1 - alpha) + c[1] * alpha
    data[i + 2] = data[i + 2] * (1 - alpha) + c[2] * alpha
  }

  for (let y = 0; y < height; y++) {
    const c = mix(scene.sky[0], scene.sky[1], y / height)
    for (let x = 0; x < width; x++) set(x, y, c)
  }

  const drawDisc = (d: Disc) => {
    const cx = d.x * width
    const cy = d.y * height
    const r = d.r * width
    for (let y = Math.max(0, Math.floor(cy - r - 1)); y < Math.min(height, Math.ceil(cy + r + 1)); y++) {
      for (let x = Math.max(0, Math.floor(cx - r - 1)); x < Math.min(width, Math.ceil(cx + r + 1)); x++) {
        const dist = Math.hypot(x - cx, y - cy)
        // One pixel of anti-aliasing at the edge.
        const alpha = Math.min(1, Math.max(0, r - dist + 0.5))
        if (alpha > 0) set(x, y, d.color, alpha)
      }
    }
  }

  if (scene.sun) drawDisc(scene.sun)

  for (const ridge of scene.ridges ?? []) {
    for (let x = 0; x < width; x++) {
      const u = x / width
      const line =
        (ridge.base +
          ridge.amplitude * Math.sin(u * Math.PI * 2 * ridge.frequency + ridge.phase) +
          ridge.amplitude * 0.35 * Math.sin(u * Math.PI * 2 * ridge.frequency * 2.7 + ridge.phase * 1.7)) *
        height
      const start = Math.max(0, Math.floor(line))
      if (start < height) set(x, start, ridge.color, 1 - (line - Math.floor(line)))
      for (let y = start + 1; y < height; y++) set(x, y, ridge.color)
    }
  }

  // Bands (sea, sand, a table) go over the hills: a lake or shore sits in
  // front of them.
  for (const band of scene.bands ?? []) {
    const top = Math.round(band.top * height)
    const bottom = Math.round(band.bottom * height)
    for (let y = top; y < bottom; y++) {
      const c = mix(band.from, band.to, (y - top) / Math.max(1, bottom - top))
      for (let x = 0; x < width; x++) set(x, y, c)
    }
  }

  for (const disc of scene.discs ?? []) drawDisc(disc)

  return { data, width, height }
}

// Writes `<uploadsDir>/<uuid>.jpg` for each scene that isn't there yet.
export async function writeDemoPhotos(uploadsDir: string, scenes: Record<string, Scene>): Promise<void> {
  await fs.mkdir(uploadsDir, { recursive: true })
  for (const [uuid, scene] of Object.entries(scenes)) {
    const file = path.join(uploadsDir, `${uuid}.jpg`)
    try {
      await fs.access(file)
      continue
    } catch {
      // Missing — paint it below.
    }
    const { data, width, height } = paint(scene)
    await sharp(data, { raw: { width, height, channels: 3 } })
      .blur(0.6)
      .jpeg({ quality: 84 })
      .toFile(file)
  }
}

// A deterministic scatter of discs (balloons, tomatoes, confetti), so every
// run paints the same picture.
export function scatter(
  count: number,
  seed: number,
  area: { x: [number, number]; y: [number, number] },
  r: [number, number],
  colors: RGB[]
): Disc[] {
  let state = seed
  const next = () => {
    state = (state * 1664525 + 1013904223) % 4294967296
    return state / 4294967296
  }
  return Array.from({ length: count }, (_, i) => ({
    x: area.x[0] + next() * (area.x[1] - area.x[0]),
    y: area.y[0] + next() * (area.y[1] - area.y[0]),
    r: r[0] + next() * (r[1] - r[0]),
    color: colors[i % colors.length],
  }))
}
