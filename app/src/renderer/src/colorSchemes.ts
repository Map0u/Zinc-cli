import type { ITheme } from '@xterm/xterm'

/** One selectable palette: the terminal's 16 ANSI colors plus the chrome surface tint they're paired with. */
export type ColorSchemeLabelKey =
  | 'ColorSchemeMonochrome'
  | 'ColorSchemeGrok'
  | 'ColorSchemeAbyss'
  | 'ColorSchemeSakura'
  | 'ColorSchemeMatcha'
  | 'ColorSchemeAmber'

export type ThemeMode = 'dark' | 'light'

export interface SchemeVariant {
  /** Base RGB for `surfaceBackground()` — the rail/terminal card's tint at RailOpacity/TerminalOpacity. */
  surfaceBase: readonly [number, number, number]
  /** Chrome accent (`--color-accent` when AccentSource is 'scheme') — Toggle/checkbox fill,
   * rail selected-tab pill, working ring, opacity slider fill. The scheme's own hue at a
   * lightness solved for contrast against its surface; Monochrome's is a plain gray. */
  accent: string
  ansi: Omit<ITheme, 'background'>
}

export interface ColorScheme {
  id: string
  labelKey: ColorSchemeLabelKey
  dark: SchemeVariant
  light: SchemeVariant
}

/** Black, white and gray; the hues are held to a whisper (OKLCH chroma ~0.05) so a diff still reads red/green. The default. */
const MONOCHROME: ColorScheme = {
  id: 'monochrome',
  labelKey: 'ColorSchemeMonochrome',
  dark: {
    surfaceBase: [18, 18, 18],
    accent: '#C8C8C8',
    ansi: {
      foreground: '#D7D7D7',
      cursor: '#E6E6E6',
      selectionBackground: '#FFFFFF33',
      black: '#222222',
      red: '#B18885',
      green: '#7C9A80',
      yellow: '#A19070',
      blue: '#7F94B1',
      magenta: '#A38AA6',
      cyan: '#6C9A9F',
      white: '#BEBEBE',
      brightBlack: '#7D7D7D',
      brightRed: '#CCA6A2',
      brightGreen: '#9BB69D',
      brightYellow: '#BCAE8F',
      brightBlue: '#9EB0CC',
      brightMagenta: '#BEA8C2',
      brightCyan: '#8DB6BB',
      brightWhite: '#F8F8F8'
    }
  },
  light: {
    surfaceBase: [250, 250, 250],
    accent: '#3D3D3D',
    ansi: {
      foreground: '#1D1D1D',
      cursor: '#1A1A1A',
      selectionBackground: '#00000024',
      black: '#1D1D1D',
      red: '#8A5F5B',
      green: '#517155',
      yellow: '#796743',
      blue: '#556B8C',
      magenta: '#7B6180',
      cyan: '#3C7277',
      white: '#666666',
      brightBlack: '#737373',
      brightRed: '#7D4F4B',
      brightGreen: '#406345',
      brightYellow: '#6C582F',
      brightBlue: '#455C7F',
      brightMagenta: '#6E5173',
      brightCyan: '#26636A',
      brightWhite: '#0B0D12'
    }
  }
}

/**
 * Grok Build TUI's default pair: GrokNight (dark) + GrokDay (light).
 * RGB values match the open-source palette in
 * `xai-grok-pager-render` `theme/groknight.rs` / `theme/grokday.rs`
 * (neutral gray base; Tokyo Night accents on dark, deepened accents on light).
 * `surfaceBase` uses each theme's `bg_base` so Acrylic under TerminalOpacity 0
 * reads the same family as Grok's fullscreen canvas.
 */
const GROK: ColorScheme = {
  id: 'grok',
  labelKey: 'ColorSchemeGrok',
  dark: {
    // BG_STORM — GrokNight main bg_base
    surfaceBase: [20, 20, 20],
    // MAGENTA — accent_assistant / accent_running
    accent: '#BB9AF7',
    ansi: {
      foreground: '#E1E1E1',
      cursor: '#C8C8C8',
      selectionBackground: '#BB9AF755',
      black: '#0A0A0A',
      red: '#F7768E',
      green: '#9ECE6A',
      yellow: '#E0AF68',
      blue: '#7AA2F7',
      magenta: '#BB9AF7',
      cyan: '#7DCFFF',
      white: '#E1E1E1',
      brightBlack: '#5A5A5A',
      brightRed: '#F7768E',
      brightGreen: '#9ECE6A',
      brightYellow: '#E0AF68',
      brightBlue: '#7AA2F7',
      brightMagenta: '#BB9AF7',
      brightCyan: '#7DCFFF',
      brightWhite: '#FFFFFF'
    }
  },
  light: {
    // BG_STORM — GrokDay main bg_base
    surfaceBase: [238, 238, 238],
    // MAGENTA deepened for light bg
    accent: '#7D4BC6',
    ansi: {
      foreground: '#262626',
      cursor: '#444444',
      selectionBackground: '#7D4BC62A',
      black: '#262626',
      red: '#CD3048',
      green: '#378E23',
      yellow: '#A27612',
      blue: '#2F64D2',
      magenta: '#7D4BC6',
      cyan: '#0082AA',
      white: '#262626',
      brightBlack: '#767676',
      brightRed: '#AF2323',
      brightGreen: '#2C7A1C',
      brightYellow: '#8A640F',
      brightBlue: '#28448A',
      brightMagenta: '#6C3EB2',
      brightCyan: '#0F87A2',
      brightWhite: '#0A0A0A'
    }
  }
}

// Each palette is generated in OKLCH and every ANSI colour's lightness is solved against its own
// surface: normal hues >= 6:1 (dark) / 5.2:1 (light), bright hues >= 8.5:1 / 6.5:1, brightBlack and the
// rest >= 4.5:1, foreground >= 13:1 / 16:1. Hue and chroma give each scheme its character; contrast is
// fixed, so no scheme has a colour that disappears against its own background.
/** Deep navy surface, bright cyan accent, the most saturated hues. */
const ABYSS: ColorScheme = {
  id: 'abyss',
  labelKey: 'ColorSchemeAbyss',
  dark: {
    surfaceBase: [7, 17, 46],
    accent: '#02B7BE',
    ansi: {
      foreground: '#CFD8ED',
      cursor: '#00C3CA',
      selectionBackground: '#02B7BE52',
      black: '#0F204C',
      red: '#E66E67',
      green: '#02A869',
      yellow: '#BA8B01',
      blue: '#5593ED',
      magenta: '#A97EE3',
      cyan: '#06A2AF',
      white: '#B5BFD2',
      brightBlack: '#757D90',
      brightRed: '#FF9088',
      brightGreen: '#52C489',
      brightYellow: '#D7A939',
      brightBlue: '#7DB1FF',
      brightMagenta: '#C39EFB',
      brightCyan: '#10C2D1',
      brightWhite: '#F9FAFD'
    }
  },
  light: {
    surfaceBase: [240, 245, 255],
    accent: '#04787E',
    ansi: {
      foreground: '#131928',
      cursor: '#066A6F',
      selectionBackground: '#04787E38',
      black: '#131928',
      red: '#BC3435',
      green: '#027649',
      yellow: '#836103',
      blue: '#1963C8',
      magenta: '#804CBD',
      cyan: '#06717B',
      white: '#5B6375',
      brightBlack: '#687082',
      brightRed: '#B10E1F',
      brightGreen: '#03653E',
      brightYellow: '#705302',
      brightBlue: '#0254B7',
      brightMagenta: '#7436B5',
      brightCyan: '#05616A',
      brightWhite: '#0B0D12'
    }
  }
}

/** Rose-tinted warm gray, cherry-blossom pink accent, warm and soft hues. */
const SAKURA: ColorScheme = {
  id: 'sakura',
  labelKey: 'ColorSchemeSakura',
  dark: {
    surfaceBase: [38, 18, 28],
    accent: '#F387B3',
    ansi: {
      foreground: '#ECD8E0',
      cursor: '#FF92BE',
      selectionBackground: '#F387B352',
      black: '#3C1F2D',
      red: '#DB7B80',
      green: '#67A470',
      yellow: '#B39249',
      blue: '#8992D5',
      magenta: '#D279B2',
      cyan: '#31A6A5',
      white: '#D1BEC6',
      brightBlack: '#8E7C83',
      brightRed: '#F69B9F',
      brightGreen: '#89C190',
      brightYellow: '#CFB070',
      brightBlue: '#A7B0EE',
      brightMagenta: '#EC9ACE',
      brightCyan: '#64C3C2',
      brightWhite: '#FCF9FA'
    }
  },
  light: {
    surfaceBase: [254, 242, 247],
    accent: '#AE4975',
    ansi: {
      foreground: '#23161C',
      cursor: '#9F3B69',
      selectionBackground: '#AE497538',
      black: '#23161C',
      red: '#AD434E',
      green: '#2B743B',
      yellow: '#836101',
      blue: '#5A60AA',
      magenta: '#A44284',
      cyan: '#037273',
      white: '#705E66',
      brightBlack: '#7D6C73',
      brightRed: '#A12D3E',
      brightGreen: '#076627',
      brightYellow: '#715301',
      brightBlue: '#4C50A0',
      brightMagenta: '#972C78',
      brightCyan: '#026263',
      brightWhite: '#110C0E'
    }
  }
}

/** Gray-green surface, matcha accent, earthy hues. */
const MATCHA: ColorScheme = {
  id: 'matcha',
  labelKey: 'ColorSchemeMatcha',
  dark: {
    surfaceBase: [17, 29, 17],
    accent: '#82B962',
    ansi: {
      foreground: '#D6E2D6',
      cursor: '#8DC56E',
      selectionBackground: '#82B96252',
      black: '#1D2F1E',
      red: '#CE8670',
      green: '#5AA967',
      yellow: '#AC974F',
      blue: '#5A9FCA',
      magenta: '#AE8AC6',
      cyan: '#3DA6B0',
      white: '#BCC8BC',
      brightBlack: '#7A857A',
      brightRed: '#E9A692',
      brightGreen: '#7FC689',
      brightYellow: '#C8B575',
      brightBlue: '#7FBDE5',
      brightMagenta: '#CBA9E0',
      brightCyan: '#6BC3CC',
      brightWhite: '#F8FBF8'
    }
  },
  light: {
    surfaceBase: [239, 249, 239],
    accent: '#467923',
    ansi: {
      foreground: '#141D15',
      cursor: '#3A6C12',
      selectionBackground: '#46792338',
      black: '#141D15',
      red: '#9F513B',
      green: '#09782F',
      yellow: '#7D6501',
      blue: '#0E6E9E',
      magenta: '#805799',
      cyan: '#05727C',
      white: '#5C665C',
      brightBlack: '#6A746A',
      brightRed: '#933F26',
      brightGreen: '#006726',
      brightYellow: '#6B5702',
      brightBlue: '#055E89',
      brightMagenta: '#73468D',
      brightCyan: '#06626B',
      brightWhite: '#0B0E0B'
    }
  }
}

/** Warm brown surface, amber accent; blues are held back and the warm hues lead. */
const AMBER: ColorScheme = {
  id: 'amber',
  labelKey: 'ColorSchemeAmber',
  dark: {
    surfaceBase: [33, 22, 12],
    accent: '#E89729',
    ansi: {
      foreground: '#EDDACA',
      cursor: '#F4A239',
      selectionBackground: '#E8972952',
      black: '#362517',
      red: '#D97E63',
      green: '#66A470',
      yellow: '#CA8A10',
      blue: '#749ABF',
      magenta: '#B785BE',
      cyan: '#5FA299',
      white: '#D3BFB0',
      brightBlack: '#8F7D70',
      brightRed: '#F39F86',
      brightGreen: '#89C190',
      brightYellow: '#E4A950',
      brightBlue: '#94B8DA',
      brightMagenta: '#D3A4D9',
      brightCyan: '#83BFB6',
      brightWhite: '#FCF9F7'
    }
  },
  light: {
    surfaceBase: [254, 242, 233],
    accent: '#995E05',
    ansi: {
      foreground: '#23160B',
      cursor: '#885300',
      selectionBackground: '#995E0538',
      black: '#23160B',
      red: '#AB472A',
      green: '#2B743B',
      yellow: '#8B5D06',
      blue: '#3E6992',
      magenta: '#885291',
      cyan: '#1B726A',
      white: '#705F52',
      brightBlack: '#7E6D5F',
      brightRed: '#9F320C',
      brightGreen: '#056627',
      brightYellow: '#784F01',
      brightBlue: '#2A5A86',
      brightMagenta: '#7C4086',
      brightCyan: '#02635A',
      brightWhite: '#110C09'
    }
  }
}

/** Selectable in Settings, in this order. */
export const COLOR_SCHEMES: readonly ColorScheme[] = [MONOCHROME, ABYSS, SAKURA, MATCHA, AMBER]

/** Not selectable: Grok's own palette, kept for the Grok full-screen surface tint (terminal/grokFullscreenSurface.ts). */
const INTERNAL_SCHEMES: readonly ColorScheme[] = [GROK]

export const DEFAULT_COLOR_SCHEME_ID = MONOCHROME.id

export function getColorScheme(id: string | undefined): ColorScheme {
  return COLOR_SCHEMES.find((s) => s.id === id) ?? INTERNAL_SCHEMES.find((s) => s.id === id) ?? MONOCHROME
}

export function resolveVariant(scheme: ColorScheme, mode: ThemeMode): SchemeVariant {
  return mode === 'light' ? scheme.light : scheme.dark
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
 * roughly sits in per theme mode — averaged from the 4 non-Monochrome accents
 * above — so a harmonized system accent reads like it belongs to this app's
 * palette family rather than Windows' own raw, more saturated/lighter accent tone.
 */
const HARMONIZED_REGISTER: Record<ThemeMode, { s: number; l: number }> = {
  dark: { s: 0.75, l: 0.6 },
  light: { s: 0.7, l: 0.34 }
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

/**
 * Black or white, whichever reads better on `hex` (a switch knob, the text of an
 * accent-filled button). Dark themes have light accents and light themes dark
 * ones, so neither colour can be fixed.
 */
export function onAccent(hex: string): string {
  const channel = (i: number): number => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  const luminance = 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5)
  // Contrast with black is (L + .05) / .05, with white 1.05 / (L + .05).
  return (luminance + 0.05) / 0.05 >= 1.05 / (luminance + 0.05) ? '#000000' : '#ffffff'
}
