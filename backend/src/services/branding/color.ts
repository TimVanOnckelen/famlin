// Minimal sRGB <-> OKLCH conversion + WCAG contrast, enough for the branding
// palette derivation in palette.ts. OKLab math per Björn Ottosson
// (https://bottosson.github.io/posts/oklab/). Hue is in degrees.

export interface Oklch {
  l: number;
  c: number;
  h: number;
}

type Rgb = [number, number, number];

const HEX_RE = /^#?([0-9a-f]{6})$/i;

export function isHexColor(value: string): boolean {
  return HEX_RE.test(value.trim());
}

export function normalizeHex(value: string): string {
  const m = HEX_RE.exec(value.trim());
  if (!m) throw new Error(`Invalid hex color: ${value}`);
  return `#${m[1].toLowerCase()}`;
}

function hexToRgb(hex: string): Rgb {
  const n = normalizeHex(hex).slice(1);
  return [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255) as Rgb;
}

function rgbToHex(rgb: Rgb): string {
  return (
    '#' +
    rgb
      .map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0'))
      .join('')
  );
}

const toLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const fromLinear = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);

function linearRgbToOklab([r, g, b]: Rgb): Rgb {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function oklabToLinearRgb([L, a, b]: Rgb): Rgb {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

export function hexToOklch(hex: string): Oklch {
  const [L, a, b] = linearRgbToOklab(hexToRgb(hex).map(toLinear) as Rgb);
  const c = Math.sqrt(a * a + b * b);
  let h = (Math.atan2(b, a) * 180) / Math.PI;
  if (h < 0) h += 360;
  return { l: L, c, h };
}

function oklchToLinearRgb({ l, c, h }: Oklch): Rgb {
  const rad = (h * Math.PI) / 180;
  return oklabToLinearRgb([l, c * Math.cos(rad), c * Math.sin(rad)]);
}

const inGamut = (rgb: Rgb) => rgb.every((v) => v >= -1e-4 && v <= 1 + 1e-4);

// Out-of-gamut colors keep their lightness and hue and lose chroma until they
// fit — the usual "chroma reduction" gamut mapping, which preserves what
// matters for a palette (how light it is, which hue family it reads as).
export function oklchToHex(color: Oklch): string {
  const l = Math.min(1, Math.max(0, color.l));
  let c = Math.max(0, color.c);
  if (!inGamut(oklchToLinearRgb({ l, c, h: color.h }))) {
    let lo = 0;
    let hi = c;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(oklchToLinearRgb({ l, c: mid, h: color.h }))) lo = mid;
      else hi = mid;
    }
    c = lo;
  }
  return rgbToHex(oklchToLinearRgb({ l, c, h: color.h }).map(fromLinear) as Rgb);
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map(toLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// Shortest angular distance between two hues, 0–180.
export function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

export function hexToRgbTriplet(hex: string): string {
  return hexToRgb(hex)
    .map((v) => Math.round(v * 255))
    .join(', ');
}
