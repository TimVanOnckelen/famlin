import { afterEach, expect, it } from 'vitest'
import { execFile } from 'child_process'
import { promisify } from 'util'
import fsp from 'fs/promises'
import os from 'os'
import path from 'path'
import sharp from 'sharp'
import { convertUpload, createUploadPreview } from '../src/services/uploadProcessing.js'

const exec = promisify(execFile)
const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => fsp.rm(directory, { recursive: true, force: true })))
})

it.each([
  ['1920x1440', 1440, 1080],
  ['1440x1920', 1080, 1440],
  ['1440x1440', 1080, 1080],
  ['320x240', 320, 240],
])('converts %s without upscaling, strips private metadata and preserves the original', async (size, width, height) => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'famlin-video-processing-'))
  directories.push(directory)
  const source = path.join(directory, 'source.mov')
  const target = path.join(directory, 'display.mp4')
  await exec('ffmpeg', [
    '-nostdin',
    '-loglevel',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    `color=c=blue:s=${size}:r=5:d=0.4`,
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=1000:duration=0.4',
    '-c:v',
    'mpeg4',
    '-c:a',
    'pcm_s16le',
    '-metadata',
    'location=+55.1234+037.1234/',
    '-metadata',
    'title=Private title',
    '-metadata',
    'comment=Private device',
    source,
  ])
  const original = await fsp.readFile(source)
  await convertUpload(source, target, true)
  const { stdout } = await exec('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', target])
  const result = JSON.parse(stdout)
  expect(result.streams[0]).toMatchObject({ codec_name: 'h264', pix_fmt: 'yuv420p', width, height })
  expect(result.streams[1]).toMatchObject({ codec_name: 'aac' })
  expect(result.format.tags).not.toHaveProperty('title')
  expect(result.format.tags).not.toHaveProperty('comment')
  expect(Object.keys(result.format.tags).some((key) => key.startsWith('location'))).toBe(false)
  const display = await fsp.readFile(target)
  const atoms: string[] = []
  for (let offset = 0; offset + 8 <= display.length;) {
    const length = display.readUInt32BE(offset)
    atoms.push(display.toString('ascii', offset + 4, offset + 8))
    if (length < 8) break
    offset += length
  }
  expect(atoms).toContain('moov')
  expect(atoms.indexOf('moov')).toBeLessThan(atoms.indexOf('mdat'))
  expect(await fsp.readFile(source)).toEqual(original)
})

it('chooses a representative poster instead of a black opening frame', async () => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'famlin-video-preview-'))
  directories.push(directory)
  const source = path.join(directory, 'source.mp4')
  const poster = path.join(directory, 'poster.jpg')
  await exec('ffmpeg', [
    '-nostdin',
    '-loglevel',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'color=c=black:s=80x60:r=10:d=0.1',
    '-f',
    'lavfi',
    '-i',
    'color=c=blue:s=80x60:r=10:d=1',
    '-filter_complex',
    '[0:v][1:v]concat=n=2:v=1:a=0',
    source,
  ])
  await createUploadPreview(source, poster, true)
  const { channels } = await sharp(poster).stats()
  expect(channels[2].mean).toBeGreaterThan(200)
  expect(channels[0].mean).toBeLessThan(30)
})
