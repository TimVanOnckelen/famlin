interface LogoProps {
  size?: number;
}

const HOUSE_PATH =
  'M24 6 Q25.6 6 26.9 6.95 L40.4 17.4 Q42 18.65 42 20.7 L42 38 Q42 42 38 42 L10 42 Q6 42 6 38 L6 20.7 Q6 18.65 7.6 17.4 L21.1 6.95 Q22.4 6 24 6 Z';
const WINDOW_CENTER = { cx: 24, cy: 20.5, r: 2.6 };
const DOOR_PATH = 'M18.5 42 L18.5 31 Q18.5 26 24 26 Q29.5 26 29.5 31 L29.5 42 Z';

export function Logo({ size = 48 }: LogoProps) {
  const radius = size * 0.22;
  const markSize = size * 0.7;
  const offset = (size - markSize) / 2;
  const scale = markSize / 48;
  const gradientId = `famlinLogoGradient-${size}`;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <defs>
        <linearGradient id={gradientId} x1="0%" y1="0%" x2="85%" y2="100%">
          <stop offset="0" stopColor="#318ea2" />
          <stop offset="1" stopColor="#005480" />
        </linearGradient>
      </defs>
      <rect width={size} height={size} rx={radius} fill={`url(#${gradientId})`} />
      <g transform={`translate(${offset}, ${offset}) scale(${scale})`}>
        <path d={HOUSE_PATH} fill="white" />
        <circle cx={WINDOW_CENTER.cx} cy={WINDOW_CENTER.cy} r={WINDOW_CENTER.r} fill="#006e94" />
        <path d={DOOR_PATH} fill="#006e94" />
      </g>
    </svg>
  );
}

export function AppIcon({ size = 200 }: LogoProps) {
  return <Logo size={size} />;
}
