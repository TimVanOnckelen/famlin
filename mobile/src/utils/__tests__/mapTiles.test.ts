import { tilesAround, TILE_SIZE } from '../mapTiles'

it('covers the whole box around the point', () => {
  const width = 400
  const height = 100
  const tiles = tilesAround(51.0543, 3.7174, 15, width, height)
  expect(Math.min(...tiles.map((t) => t.left))).toBeLessThanOrEqual(-width / 2)
  expect(Math.max(...tiles.map((t) => t.left + TILE_SIZE))).toBeGreaterThanOrEqual(width / 2)
  expect(Math.min(...tiles.map((t) => t.top))).toBeLessThanOrEqual(-height / 2)
  expect(Math.max(...tiles.map((t) => t.top + TILE_SIZE))).toBeGreaterThanOrEqual(height / 2)
  // No more than the box needs.
  expect(tiles.length).toBeLessThanOrEqual(6)
})

it('picks the tile the point is in', () => {
  // Ghent at zoom 15, per the OSM slippy-map formula.
  const tiles = tilesAround(51.0543, 3.7174, 15, 1, 1)
  expect(tiles).toHaveLength(1)
  expect(tiles[0]).toMatchObject({ x: 16722, y: 10962 })
})

it('wraps across the date line and stops at the poles', () => {
  const count = 2 ** 3
  const dateLine = tilesAround(0, 179.99, 3, 400, 100)
  expect(dateLine.map((t) => t.x)).toContain(0)
  expect(dateLine.every((t) => t.x >= 0 && t.x < count)).toBe(true)
  const pole = tilesAround(89, 0, 3, 400, 400)
  expect(pole.length).toBeGreaterThan(0)
  expect(pole.every((t) => t.y >= 0 && t.y < count)).toBe(true)
})
