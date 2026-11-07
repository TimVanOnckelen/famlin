// Generated from tokens.json. Run npm run generate.
export const tokens = {
  "color": {
    "primary": "#006e94",
    "primary-dark": "#005480",
    "primary-light": "#318ea2",
    "primary-tint": "#daf3fe",
    "accent": "#ed835e",
    "milestone": "#eeb154",
    "bg": "#edf7fb",
    "surface": "#ffffff",
    "border": "#d9e3e7",
    "text-muted": "#597784",
    "text-body": "#233036",
    "text-title": "#0f222a",
    "primary-mid": "#187191",
    "muted": "#e7f0f3",
    "destructive": "#c94a3e",
    "success": "#1c7c3b",
    "warning": "#8a5b0f",
    "white": "#ffffff"
  },
  "radius": {
    "control": 18
  },
  "spacing": {
    "1": 4,
    "2": 8,
    "3": 12,
    "4": 16,
    "6": 24,
    "8": 32
  },
  "font": {
    "body": {
      "family": "Nunito"
    }
  },
  "gradient": {
    "brand": {
      "angle": 150,
      "colors": [
        "#318ea2",
        "#005480"
      ]
    }
  },
  "shadow": {
    "default": {
      "offsetX": 0,
      "offsetY": 2,
      "blurRadius": 12,
      "spreadDistance": 0,
      "color": "#000000",
      "opacity": 0.07
    },
    "small": {
      "offsetX": 0,
      "offsetY": 1,
      "blurRadius": 4,
      "spreadDistance": 0,
      "color": "#000000",
      "opacity": 0.06
    },
    "primary": {
      "offsetX": 0,
      "offsetY": 4,
      "blurRadius": 14,
      "spreadDistance": 0,
      "color": "#006e94",
      "opacity": 0.32
    }
  }
} as const
export type DesignTokens = typeof tokens
export default tokens
