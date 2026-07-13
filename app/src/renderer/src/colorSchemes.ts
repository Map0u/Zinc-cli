import type { ITheme } from '@xterm/xterm'

/** One selectable palette: the terminal's 16 ANSI colors plus the chrome surface tint they're paired with. */
export type ColorSchemeLabelKey =
  | 'ColorSchemeMonochrome'
  | 'ColorSchemeRosePine'
  | 'ColorSchemeTokyoNight'
  | 'ColorSchemeVesper'
  | 'ColorSchemeEverforest'
  | 'ColorSchemeCampbell'

export type ThemeMode = 'dark' | 'light'

export interface SchemeVariant {
  /** Base RGB for `surfaceBackground()` — the rail/terminal card's tint at RailOpacity/TerminalOpacity. */
  surfaceBase: readonly [number, number, number]
  /** Chrome accent (`--color-accent` when AccentSource is 'scheme') — Toggle/checkbox fill,
   * rail selected-tab pill, opacity slider fill. A hand-picked hue per scheme, not derived
   * from `ansi.cursor` (Campbell/Monochrome's cursor is white, which would make a white
   * toggle) — reuses a hue already defined elsewhere in that same scheme's ansi set. */
  accent: string
  ansi: Omit<ITheme, 'background'>
}

export interface ColorScheme {
  id: string
  labelKey: ColorSchemeLabelKey
  dark: SchemeVariant
  light: SchemeVariant
}

const AOD_VARIANT: SchemeVariant = {
  surfaceBase: [0, 0, 0],
  accent: '#D69A3C',
  ansi: {
    foreground: '#888888',
    cursor: '#D69A3C',
    selectionBackground: '#D69A3C33',
    black: '#000000',
    red: '#777777',
    green: '#777777',
    yellow: '#D69A3C',
    blue: '#666666',
    magenta: '#777777',
    cyan: '#777777',
    white: '#888888',
    brightBlack: '#555555',
    brightRed: '#888888',
    brightGreen: '#888888',
    brightYellow: '#D69A3C',
    brightBlue: '#777777',
    brightMagenta: '#888888',
    brightCyan: '#888888',
    brightWhite: '#888888'
  }
}

/** True black/white/gray — deliberately undyed (the one scheme the user asked to leave plain rather than stylized). */
const MONOCHROME: ColorScheme = {
  id: 'monochrome',
  labelKey: 'ColorSchemeMonochrome',
  dark: {
    surfaceBase: [16, 16, 16],
    accent: '#C8C8C8',
    ansi: {
      foreground: '#E8E8E8',
      cursor: '#FFFFFF',
      selectionBackground: '#FFFFFF33',
      black: '#141414',
      red: '#9A9A9A',
      green: '#9A9A9A',
      yellow: '#9A9A9A',
      blue: '#9A9A9A',
      magenta: '#9A9A9A',
      cyan: '#9A9A9A',
      white: '#E8E8E8',
      brightBlack: '#5A5A5A',
      brightRed: '#C8C8C8',
      brightGreen: '#C8C8C8',
      brightYellow: '#C8C8C8',
      brightBlue: '#C8C8C8',
      brightMagenta: '#C8C8C8',
      brightCyan: '#C8C8C8',
      brightWhite: '#FFFFFF'
    }
  },
  light: {
    surfaceBase: [246, 246, 246],
    accent: '#454545',
    ansi: {
      foreground: '#1A1A1A',
      cursor: '#000000',
      selectionBackground: '#00000022',
      black: '#2A2A2A',
      red: '#6E6E6E',
      green: '#6E6E6E',
      yellow: '#6E6E6E',
      blue: '#6E6E6E',
      magenta: '#6E6E6E',
      cyan: '#6E6E6E',
      white: '#1A1A1A',
      brightBlack: '#8C8C8C',
      brightRed: '#454545',
      brightGreen: '#454545',
      brightYellow: '#454545',
      brightBlue: '#454545',
      brightMagenta: '#454545',
      brightCyan: '#454545',
      brightWhite: '#000000'
    }
  }
}

// Restrained/low-saturation dark palettes, each inspired by
// (not a literal reproduction of) a named community theme — hand-tuned for hue separation
// and foreground contrast rather than copied hex-for-hex. Light variants likewise inspired
// by that theme's own published light companion where one exists (Rosé Pine Dawn, Tokyo
// Night Light, Everforest Light), re-tuned to this app's register.
const ROSE_PINE: ColorScheme = {
  id: 'rosePine',
  labelKey: 'ColorSchemeRosePine',
  dark: {
    surfaceBase: [30, 26, 36],
    accent: '#D48CEE',
    ansi: {
      foreground: '#E9E1F5',
      cursor: '#D48CEE',
      selectionBackground: '#D48CEE55',
      black: '#241F33',
      red: '#E0708C',
      green: '#8FBCAE',
      yellow: '#E0C088',
      blue: '#8FAEDD',
      magenta: '#D48CEE',
      cyan: '#8FD1D1',
      white: '#E9E1F5',
      brightBlack: '#7A6F99',
      brightRed: '#EC93A9',
      brightGreen: '#A8CCC0',
      brightYellow: '#EDD19F',
      brightBlue: '#A9C3EA',
      brightMagenta: '#E3AAF7',
      brightCyan: '#A9E2E2',
      brightWhite: '#F5EFFB'
    }
  },
  light: {
    surfaceBase: [250, 244, 237],
    accent: '#9440BE',
    ansi: {
      foreground: '#4A3E63',
      cursor: '#9440BE',
      selectionBackground: '#9440BE2A',
      black: '#5B4E75',
      red: '#B4415E',
      green: '#2C7A66',
      yellow: '#B4770B',
      blue: '#3C5FA8',
      magenta: '#9440BE',
      cyan: '#2C7E82',
      white: '#4A3E63',
      brightBlack: '#7C6E96',
      brightRed: '#9A3450',
      brightGreen: '#256657',
      brightYellow: '#976409',
      brightBlue: '#324F8A',
      brightMagenta: '#7C359C',
      brightCyan: '#25696D',
      brightWhite: '#2E2540'
    }
  }
}

const TOKYO_NIGHT: ColorScheme = {
  id: 'tokyoNight',
  labelKey: 'ColorSchemeTokyoNight',
  dark: {
    surfaceBase: [19, 20, 32],
    accent: '#7AA2F7',
    ansi: {
      foreground: '#C0CAF5',
      cursor: '#7AA2F7',
      selectionBackground: '#7AA2F755',
      black: '#1F2335',
      red: '#D97C93',
      green: '#8FBD88',
      yellow: '#D9B471',
      blue: '#7AA2F7',
      magenta: '#B98FD1',
      cyan: '#7DCFCB',
      white: '#C0CAF5',
      brightBlack: '#565F89',
      brightRed: '#E89AAC',
      brightGreen: '#A6D19E',
      brightYellow: '#E6CC94',
      brightBlue: '#9EBCF9',
      brightMagenta: '#CBA8E0',
      brightCyan: '#9BE0DC',
      brightWhite: '#E8ECFB'
    }
  },
  light: {
    surfaceBase: [222, 224, 233],
    accent: '#34548A',
    ansi: {
      foreground: '#343B58',
      cursor: '#34548A',
      selectionBackground: '#34548A2A',
      black: '#3F4562',
      red: '#8C4351',
      green: '#33635C',
      yellow: '#8F5E15',
      blue: '#34548A',
      magenta: '#5A4A78',
      cyan: '#0F4B6E',
      white: '#343B58',
      brightBlack: '#5A6089',
      brightRed: '#7A303F',
      brightGreen: '#275048',
      brightYellow: '#764B0C',
      brightBlue: '#294676',
      brightMagenta: '#493A66',
      brightCyan: '#0B3B57',
      brightWhite: '#1E2136'
    }
  }
}

const VESPER: ColorScheme = {
  id: 'vesper',
  labelKey: 'ColorSchemeVesper',
  dark: {
    surfaceBase: [12, 11, 10],
    accent: '#FFC247',
    ansi: {
      foreground: '#E8E1D3',
      cursor: '#FFC247',
      selectionBackground: '#FFC24755',
      black: '#161412',
      red: '#D97757',
      green: '#A8B885',
      yellow: '#FFC247',
      blue: '#8DA3C0',
      magenta: '#C08FB0',
      cyan: '#8FC1BF',
      white: '#E8E1D3',
      brightBlack: '#6E6A63',
      brightRed: '#EC9270',
      brightGreen: '#C0CC9F',
      brightYellow: '#FFD778',
      brightBlue: '#A8BEDA',
      brightMagenta: '#D8A6C8',
      brightCyan: '#ACD6D3',
      brightWhite: '#F7F1E4'
    }
  },
  light: {
    surfaceBase: [250, 246, 236],
    accent: '#A66A00',
    ansi: {
      foreground: '#2A2520',
      cursor: '#A66A00',
      selectionBackground: '#A66A0030',
      black: '#3A332B',
      red: '#B4482E',
      green: '#5C7A3F',
      yellow: '#A66A00',
      blue: '#3F5E85',
      magenta: '#8C5478',
      cyan: '#3C7E7A',
      white: '#2A2520',
      brightBlack: '#6E6355',
      brightRed: '#96381F',
      brightGreen: '#4A6633',
      brightYellow: '#8A5600',
      brightBlue: '#33496B',
      brightMagenta: '#734363',
      brightCyan: '#2F6662',
      brightWhite: '#14110D'
    }
  }
}

const EVERFOREST: ColorScheme = {
  id: 'everforest',
  labelKey: 'ColorSchemeEverforest',
  dark: {
    surfaceBase: [21, 26, 22],
    accent: '#89C05F',
    ansi: {
      foreground: '#D3C9A1',
      cursor: '#89C05F',
      selectionBackground: '#89C05F55',
      black: '#252E27',
      red: '#E06C56',
      green: '#89C05F',
      yellow: '#DBB847',
      blue: '#5C9DC6',
      magenta: '#D678B0',
      cyan: '#4FBF9F',
      white: '#D3C9A1',
      brightBlack: '#6B6D5F',
      brightRed: '#E88B70',
      brightGreen: '#A3D680',
      brightYellow: '#E8CC6C',
      brightBlue: '#7EB6DA',
      brightMagenta: '#E093C4',
      brightCyan: '#72D3B4',
      brightWhite: '#E5DFC0'
    }
  },
  light: {
    surfaceBase: [253, 246, 227],
    accent: '#5C8A1E',
    ansi: {
      foreground: '#3C4841',
      cursor: '#5C8A1E',
      selectionBackground: '#5C8A1E2A',
      black: '#4A5850',
      red: '#C4362A',
      green: '#5C8A1E',
      yellow: '#A87E00',
      blue: '#286B92',
      magenta: '#B5478C',
      cyan: '#1E8A70',
      white: '#3C4841',
      brightBlack: '#6C7A70',
      brightRed: '#A82A20',
      brightGreen: '#4A7418',
      brightYellow: '#8E6A00',
      brightBlue: '#20597B',
      brightMagenta: '#9C3C76',
      brightCyan: '#19735F',
      brightWhite: '#242C27'
    }
  }
}

// Compatibility palette for users who prefer familiar Windows terminal colors.
// It remains selectable rather than becoming the default. The light variant is
// Windows Terminal's own "Campbell" convention of pairing the same saturated ANSI hues
// with a light backdrop, not a copied asset.
const CAMPBELL: ColorScheme = {
  id: 'campbell',
  labelKey: 'ColorSchemeCampbell',
  dark: {
    surfaceBase: [12, 12, 12],
    accent: '#3A96DD',
    ansi: {
      foreground: '#CCCCCC',
      cursor: '#FFFFFF',
      selectionBackground: '#3A96DD55',
      black: '#0C0C0C',
      red: '#C50F1F',
      green: '#13A10E',
      yellow: '#C19C00',
      blue: '#0037DA',
      magenta: '#881798',
      cyan: '#3A96DD',
      white: '#CCCCCC',
      brightBlack: '#767676',
      brightRed: '#E74856',
      brightGreen: '#16C60C',
      brightYellow: '#F9F1A5',
      brightBlue: '#3B78FF',
      brightMagenta: '#B4009E',
      brightCyan: '#61D6D6',
      brightWhite: '#F2F2F2'
    }
  },
  light: {
    surfaceBase: [245, 245, 245],
    accent: '#2472A4',
    ansi: {
      foreground: '#0C0C0C',
      cursor: '#000000',
      selectionBackground: '#0037DA33',
      black: '#0C0C0C',
      red: '#C50F1F',
      green: '#0A7B05',
      yellow: '#996E00',
      blue: '#0037DA',
      magenta: '#881798',
      cyan: '#2472A4',
      white: '#CCCCCC',
      brightBlack: '#767676',
      brightRed: '#E74856',
      brightGreen: '#16A80C',
      brightYellow: '#C19C00',
      brightBlue: '#3B78FF',
      brightMagenta: '#B4009E',
      brightCyan: '#3A96DD',
      brightWhite: '#F2F2F2'
    }
  }
}

export const COLOR_SCHEMES: readonly ColorScheme[] = [
  MONOCHROME,
  ROSE_PINE,
  TOKYO_NIGHT,
  VESPER,
  EVERFOREST,
  CAMPBELL
]

export const DEFAULT_COLOR_SCHEME_ID = MONOCHROME.id

export function getColorScheme(id: string | undefined): ColorScheme {
  return COLOR_SCHEMES.find((s) => s.id === id) ?? MONOCHROME
}

export function resolveVariant(scheme: ColorScheme, mode: ThemeMode): SchemeVariant {
  return mode === 'light' ? scheme.light : scheme.dark
}

export function getAodVariant(): SchemeVariant {
  return AOD_VARIANT
}

/**
 * Extracts hue (0-360) and saturation (0-1) from a hex color. harmonizeAccent needs both:
 * hue to carry the system accent's identity through, saturation to detect the achromatic
 * case (a gray/near-gray "Automatic" Windows accent from a grayscale wallpaper) where hue
 * is meaningless and would otherwise resolve to an arbitrary, wrong-looking red.
 */
function hexToHueSat(hex: string): { h: number; s: number } {
  const clean = hex.replace('#', '')
  const r = parseInt(clean.substring(0, 2), 16) / 255
  const g = parseInt(clean.substring(2, 4), 16) / 255
  const b = parseInt(clean.substring(4, 6), 16) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  if (d === 0) return { h: 0, s: 0 }
  const l = (max + min) / 2
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h: number
  switch (max) {
    case r:
      h = ((g - b) / d + (g < b ? 6 : 0)) * 60
      break
    case g:
      h = ((b - r) / d + 2) * 60
      break
    default:
      h = ((r - g) / d + 4) * 60
  }
  return { h, s }
}

function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  let r = 0
  let g = 0
  let b = 0
  if (h < 60) {
    r = c
    g = x
  } else if (h < 120) {
    r = x
    g = c
  } else if (h < 180) {
    g = c
    b = x
  } else if (h < 240) {
    g = x
    b = c
  } else if (h < 300) {
    r = x
    b = c
  } else {
    r = c
    b = x
  }
  const toHex = (v: number): string =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, '0')
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase()
}

/**
 * Register (saturation/lightness) each hand-picked scheme accent in this file
 * roughly sits in per theme mode — averaged from the 5 non-Monochrome accents
 * above — so a harmonized system accent reads like it belongs to this app's
 * palette family rather than Windows' own raw, more saturated/lighter accent tone.
 */
const HARMONIZED_REGISTER: Record<ThemeMode, { s: number; l: number }> = {
  dark: { s: 0.72, l: 0.68 },
  light: { s: 0.6, l: 0.38 }
}

/**
 * AccentSource 'system': keep the real Windows accent color's hue (so it still
 * visibly "follows" the system color the user picked), but replace its
 * saturation/lightness with this app's own register — a raw passthrough of
 * Windows' Light2 shade reads noticeably brighter/more saturated than every
 * hand-picked scheme accent and looks out of place next to them.
 */
export function harmonizeAccent(osAccentHex: string, mode: ThemeMode): string {
  const { h, s: rawS } = hexToHueSat(osAccentHex)
  const { s, l } = HARMONIZED_REGISTER[mode]
  // Achromatic system accent (e.g. Windows "Automatic" derived from a grayscale
  // wallpaper) — hue has no meaning here; hslToHex(_, 0, l) ignores h and yields
  // a neutral gray, avoiding an arbitrary (otherwise red) hue.
  if (rawS < 0.05) return hslToHex(0, 0, l)
  return hslToHex(h, s, l)
}
