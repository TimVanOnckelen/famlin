import React from 'react'
import { View, Text, StyleSheet, useWindowDimensions } from 'react-native'
import { Image } from 'expo-image'

import { colors } from '@/constants/colors'
import { tilesAround, TILE_SIZE } from '@/utils/mapTiles'

// The same CARTO Voyager tiles LeafletMap draws, at retina resolution.
const tileUrl = (zoom: number, x: number, y: number) =>
  `https://${'abcd'[(x + y) % 4]}.basemaps.cartocdn.com/rastertiles/voyager/${zoom}/${x}/${y}@2x.png`

// A map that can't be moved: a few tile images with a marker on top. Used
// where a map is only a preview (post cards, the post detail screen), because
// LeafletMap's WebView costs a web process and a main-thread hitch each time
// one scrolls into a list. The interactive picker still uses LeafletMap.
export function StaticMap({
  latitude,
  longitude,
  zoom = 15,
  height,
}: {
  latitude: number
  longitude: number
  zoom?: number
  height: number
}) {
  // The map is never wider than the window, so that's the box to cover
  // without waiting for a layout pass.
  const { width } = useWindowDimensions()
  const tiles = tilesAround(latitude, longitude, zoom, width, height)

  return (
    <View style={[styles.container, { height }]}>
      <View style={styles.center}>
        {tiles.map((tile) => (
          <Image
            key={tile.key}
            source={{ uri: tileUrl(zoom, tile.x, tile.y) }}
            style={[styles.tile, { left: tile.left, top: tile.top }]}
            cachePolicy="memory-disk"
          />
        ))}
        <View style={styles.marker} />
      </View>
      {/* Required credit for the map data and tiles; names, so not translated. */}
      <Text style={styles.attribution}>© OpenStreetMap © CARTO</Text>
    </View>
  )
}

const MARKER_SIZE = 18

const styles = StyleSheet.create({
  container: {
    width: '100%',
    overflow: 'hidden',
    backgroundColor: colors.border,
  },
  // A zero-size anchor at the middle of the map; tiles and the marker are
  // placed relative to it.
  center: {
    position: 'absolute',
    left: '50%',
    top: '50%',
  },
  tile: {
    position: 'absolute',
    width: TILE_SIZE,
    height: TILE_SIZE,
  },
  marker: {
    position: 'absolute',
    left: -MARKER_SIZE / 2,
    top: -MARKER_SIZE / 2,
    width: MARKER_SIZE,
    height: MARKER_SIZE,
    borderRadius: MARKER_SIZE / 2,
    backgroundColor: colors.primary,
    borderWidth: 3,
    borderColor: colors.white,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.3,
    shadowRadius: 2,
    elevation: 3,
  },
  attribution: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    paddingHorizontal: 4,
    paddingVertical: 1,
    fontSize: 9,
    color: '#333',
    backgroundColor: 'rgba(255,255,255,0.7)',
  },
})
