// Web Mercator tile maths for StaticMap: which raster tiles cover a box of
// `width` x `height` points centred on a coordinate, and where each one sits
// relative to that centre.

export const TILE_SIZE = 256

// Beyond this latitude the Mercator projection has no tiles.
const MAX_LATITUDE = 85.0511

export interface MapTile {
  key: string
  x: number
  y: number
  // Offset of the tile's top-left corner from the centre point, in points.
  left: number
  top: number
}

export function tilesAround(latitude: number, longitude: number, zoom: number, width: number, height: number) {
  const count = 2 ** zoom
  const lat = (Math.max(-MAX_LATITUDE, Math.min(MAX_LATITUDE, latitude)) * Math.PI) / 180
  const centerX = ((longitude + 180) / 360) * count * TILE_SIZE
  const centerY = ((1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2) * count * TILE_SIZE

  const tiles: MapTile[] = []
  const lastColumn = Math.floor((centerX + width / 2) / TILE_SIZE)
  const lastRow = Math.floor((centerY + height / 2) / TILE_SIZE)
  for (let row = Math.floor((centerY - height / 2) / TILE_SIZE); row <= lastRow; row++) {
    // Nothing above the north or below the south edge of the map.
    if (row < 0 || row >= count) continue
    for (let column = Math.floor((centerX - width / 2) / TILE_SIZE); column <= lastColumn; column++) {
      // The map repeats sideways, so a column past either edge wraps around.
      const x = ((column % count) + count) % count
      tiles.push({
        key: `${column}/${row}`,
        x,
        y: row,
        left: column * TILE_SIZE - centerX,
        top: row * TILE_SIZE - centerY,
      })
    }
  }
  return tiles
}
