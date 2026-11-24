import React, { useMemo } from 'react'
import Svg, { Path, Rect } from 'react-native-svg'

import { encodeQr } from '@/utils/qrCode'

const QUIET_ZONE = 4

// A QR code drawn as one SVG path, always dark on white so every scanner
// reads it whatever the theme.
export function QrCodeView({ value, size = 220 }: { value: string; size?: number }) {
  const { total, path } = useMemo(() => {
    const { size: modules, modules: matrix } = encodeQr(value)
    let d = ''
    for (let y = 0; y < modules; y++) {
      for (let x = 0; x < modules; x++) {
        if (matrix[y][x]) d += `M${x + QUIET_ZONE} ${y + QUIET_ZONE}h1v1h-1z`
      }
    }
    return { total: modules + QUIET_ZONE * 2, path: d }
  }, [value])

  return (
    <Svg width={size} height={size} viewBox={`0 0 ${total} ${total}`} accessibilityRole="image">
      <Rect width={total} height={total} fill="#ffffff" />
      <Path d={path} fill="#000000" />
    </Svg>
  )
}
