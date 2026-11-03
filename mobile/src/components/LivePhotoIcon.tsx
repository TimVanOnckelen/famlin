import Svg, { Circle } from 'react-native-svg'

export function LivePhotoIcon({ size = 18, color = 'white' }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.7}>
      <Circle cx={12} cy={12} r={9.5} strokeDasharray="1.5 2.2" />
      <Circle cx={12} cy={12} r={6.2} />
      <Circle cx={12} cy={12} r={2.5} />
    </Svg>
  )
}
